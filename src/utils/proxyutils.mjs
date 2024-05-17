/**
 * platform independent proxy Utils
 */

/**
 * common function used by the cache proxy
 */
export const proxyUtils = {

  /**
   * delete a single (or multiple if its spread across multiple items)
   * @param {object} p the params
   * @param {string} p.hashedKey the key
   * @param {function} p.getter how to get an item
   * @param {function} p.deleter how to delete an item
   * @returns {number} 0 or 1 (always 1 no matter how many items were deleted)
   */
  delPack: async ({ hashedKey, getter, deleter, config }) => {
    // if we delete, and it's a chunk, we need to delete all of it
    const value = await getter(hashedKey);
    // next unpack
    const pack = value && (await proxyUtils.payUnpack({ value, config }));
    if (!pack) return 0;

    // first delete the master
    const r = await deleter(hashedKey);

    // then delete all trailers
    if (pack.keys) {
      // delete any intermediate items
      return Promise.all(pack.keys.map((k) => deleter(k)))
        .then((dels) => dels.every((d) => d === 1))
        .then((dels) => {
          if (!dels) {
            console.log(
              `...warning - failed to deleted every known trailer item for ${hashedKey}`
            );
          }
          return r;
        });
    } else {
      return r;
    }
  },

  /**
   * gets an item and upacks it/converts it back to original state/works across multiple items if necessary
   * @param {object} p params
   * @param {string} p.hashedKey the key
   * @param {object} p.config the config rules
   * @param {function} p.getter how to get an item
   * @returns {*} the recustructed object ({value:*, hashedKey: string, timestamp: number }) || null
   */
  unsetPack: async ({ hashedKey, config, getter }) => {
    const value = await getter(hashedKey);

    // next unpack
    const pack = value && (await proxyUtils.payUnpack({ value, config }));
    if (!pack) return null;

    if (pack.keys) {
      // if this is a key record, we need a getter to pick up the trailers
      const parsedValue = await Promise.all(
        pack.keys.map((k) => getter(k))
      ).then((vs) => {
        if (!vs.every((d) => d)) {
          console.log(
            `...failed to find every trailer record for ${hashedKey} ... skipping`
          );
          return null;
        } else {
          return proxyUtils.payUnpack({ value: vs.join(""), config });
        }
      });

      // now join the values
      return parsedValue
        ? {
            t: pack.t,
            value: parsedValue.value,
            hashedKey,
          }
        : null;
    } else {
      return {
        ...pack,
        hashedKey,
      };
    }
  },
  /**
   * the idea here is to pack the value into an object and stringify it
   * if the size is more than some limit, then we'll also gzip it
   * @param {object} p params
   * @param {*} p.value the value to stringify
   * @param {object} p.config configuration options
   * @param {boolean} [p.master] this is a master record with keys only
   * @returns {string} the value as a string ready to be written to store
   */
  payPack: async ({ config, value, master = false }) => {
    let pack;
    const { zipper, toBase64 } = config;
    try {
      // we'also encode the time it was written at
      // if this is a master record we have a k property
      // otherwise we have a k property
      const ob = {
        t: new Date().getTime(),
      };
      const p = master ? "k" : "p";
      ob[p] = value;
      pack = JSON.stringify(ob);
    } catch (err) {
      console.log("...error - skipping - cant payPack payload for", key);
      return null;
    }
    // if its big enough, zip it
    if (config.gzip && pack.length > config.gzipThreshold) {
      const p = await zipper(pack);
      const z = JSON.stringify({
        z: toBase64(p),
      });
      // it'spossible that the zipped is larger than the original
      if (pack.length < z.length) {
        console.log(
          `The zipped version is longer${z.length} than the original ${pack.length} .. consider increasing gzipThreshold from ${config.gzipThreshold}`
        );
        return pack;
      } else {
        return z;
      }
    } else {
      return pack;
    }
  },

  /**
   * undoes what payPack did an convertes the stringified value back to whatever it was originally, unzipping if necessary
   * @param {object} p the params
   * @param {string} p.value the stringified packed value retrieved from the store
   * @param {object} p.config the config
   * @returns {*} whatever was packed in the first place
   */
  payUnpack: async ({ value, config }) => {
    let pack;
    const { unzipper , fromBase64 } = config;
    try {
      pack = JSON.parse(value);
    } catch (err) {
      console.log("...unable to parse cache value", value);
      return null;
    }
    // it was a vanilla value
    // p- the value or null
    // z- the zipped value
    // t- the timestamp
    // k- if this is amaster record, the keys for the trailer
    const { p, z, t, k } = pack;
    if (p || k) {
      return {
        value: p,
        timeStamp: t,
        keys: k,
      };
    }

    // it was a big zipped one
    if (z) {
      const u = await unzipper(fromBase64(z));
      const ob = JSON.parse(u.toString());
      return {
        value: ob.p,
        timestamp: ob.t,
        keys: ob.k,
      };
    }

    // neither so vanilla
    return value;
  },

  /**
   * create an array of items/ chunked / zipped as required
   * @param {object} p args
   * @param {string} p.hashedKey the key
   * @param {*} p.value the value to write
   * @param {object} p.config the store config values
   * @return {string} "OK"
   */
  setPack: async ({ hashedKey, value, config, setter }) => {
    // pack the entire value
    const { zipper } = config;
    const packedString = await proxyUtils.payPack({ config, value, zipper });

    // it's possible that the length of the zipped or plain value is too big
    // so make an array of items
    if (packedString.length > config.maxChunk) {
      const values = Array.from(chunkIt(packedString, config.maxChunk)).map(
        (value, i) => ({
          key: `${hashedKey}-${i}`,
          value,
        })
      );
      // now create a master record containing the keys
      const keys = values.map((f) => f.key);
      const master = await proxyUtils.payPack({
        master: true,
        config,
        value: keys,
      });

      const load = [
        {
          key: hashedKey,
          value: master,
        },
      ].concat(values);
      return Promise.all(load.map((f) => setter(f.key, f.value))).then((r) =>
        r.every((ok) => ok == "OK") ? "OK" : null
      );
    } else {
      return setter(hashedKey, packedString);
    }
  },
};
export const chunkIt = (inputArray, size) => {
  // like slice
  const end = inputArray.length;
  let start = 0;
  return {
    *[Symbol.iterator]() {
      while (start < end) {
        const chunk = inputArray.slice(start, Math.min(end, size + start));
        start += chunk.length;
        yield chunk;
      }
    },
  };
};