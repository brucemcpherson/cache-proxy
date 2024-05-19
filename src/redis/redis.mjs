import Redis from "ioredis";
import { proxyUtils } from "../utils/proxyutils.mjs";
import { cacheSettings } from "../../configs/cachesettings.mjs";

let config;
export const fetchConfig = () => config;

// get connection
// this is actually a proxy to the client
// so we can intercept the key,hash it to a string and add a prefix

const getRedisProxy = async ({
  redisConfigs,
  database,
  useProxy = true,
  testConnectivity = true,
  extraConfig = "redis",
}) => {
  // we can have different configs for different databases/or partitions of the same database
  const getConfig = ({ database, extraConfig }) => ({
    ...redisConfigs.databases[database],
    ...cacheSettings[extraConfig],
  });

  // i get my parameters elsewhere from secret manager via env
  config = getConfig({ database, extraConfig });

  // to support multiple platforms/harmoze the prop names
  const { propMap } = config;

  // so this is the vanilla client
  const client = new Redis({
    password: config.password,
    host: config.host,
    port: config.port,
  });

  // if we dont need a proxy, just return the vanilla client
  if (!useProxy)
    return testConnectivity ? testConnect({ client, useProxy }) : client;

  // now intercept a function call to fiddle with the first arg
  const { prefix = "" } = config;

  // specific hasher for node
  const makeKey = (key) => config.makeKey({ prefix, key });

  /**
   * the idea here is to pack the value into an object and stringify it
   * if the size is more than some limit, then we'll also gzip it
   * @param {*} value the item to pack
   * @returns {string} the value as a string ready to be written to store
   */
  const payPack = async (value) => proxyUtils.payPack({ config, value });

  /**
   * if an item spreads on more than 1 physical record, it needs to delete all the associated records
   * @param {*} value
   * @returns {string} the value as a string ready to be written to store
   */
  const delPack = async (hashedKey, deleter, getter) =>
    proxyUtils.delPack({ hashedKey, getter, deleter, config });

  /**
   * undoes what payPack did an convertes the stringified value back to whatever it was originally, unzipping if necessary
   * @param {string} value the stringified packed value retrieved from the store
   * @returns {*} whatever was packed in the first place
   */
  const payUnpack = async (value) => proxyUtils.payUnpack({ value, config });

  // construct default expiration
  // if there's already an EX arg we dont need to specify it again
  const getExArgs = ({ prop, otherArgs }) =>
    propMap[prop] !== "set" ||
    otherArgs.find((f) =>
      ["ex", "exat", "px", "pxat"].some((g) => g === f.toLowerCase())
    ) ||
    !config.expiration ||
    config.expiration === Infinity
      ? []
      : ["EX", config.expiration];

  /**
   * apply handler for fixing up the keys and data
   */
  const applyHandler = async (prop, func, thisArg, args) => {
    // if there are no args, we'll just apply the function as is
    if (!args.length) return func.apply(thisArg, args);

    // the first arg for handled functions will always be the key
    // so we'll hash that to a b64 value
    const [key] = args;
    const hashedKey = makeKey(key);

    // the rest of the args will start with the value if we're doing a set
    const [value] = args.slice(1);
    const otherArgs = args.slice(2);

    // construct default expiration
    // if there's already an EX arg we dont need to specify it again
    const exArgs = getExArgs({ prop, otherArgs });

    // this applies the selected method
    const commit = async (hashedKey, packedValue) => {
      const fargs = [hashedKey]
        .concat(packedValue ? [packedValue] : [], exArgs, otherArgs)
        .slice(0, args.length + exArgs.length);
      return func.apply(thisArg, fargs);
    };

    // special handling for packing/unpacking
    switch (propMap[prop]) {
      case "set":
        // this will pack/zip/chunk etc as required
        return setPack(hashedKey, value, commit);

      // in this case we potentially need to get multiple items
      case "get":
        return unsetPack(hashedKey, commit);

      /// delete may actually have to delete multiple recs so it needs a getter
      case "del":
        const getProp = Reflect.ownKeys(propMap).find(
          (f) => propMap[f] === "get"
        );
        if (!getProp) throw `couldnt find get prop for get in propMap`;
        const getter = async (hashedKey) =>
          client[getProp](hashedKey, ...args.slice(1));
        return delPack(hashedKey, commit, getter);

      // everything else is vanilla
      default:
        return commit(hashedKey, value);
    }
  };

  // we don't hash every property - just these for now
  const hashProps = new Set([
    "set",
    "get",
    "exists",
    "expire",
    "ttl",
    "persist",
    "del",
  ]);

  const setPack = async (hashedKey, value, setter) =>
    proxyUtils.setPack({ hashedKey, value, config, setter });

  const unsetPack = async (hashedKey, getter) =>
    proxyUtils.unsetPack({ hashedKey, config, getter });

  // these function can be exported as part of the proxy so more complex redis commands are avail
  const proxyExports = {
    proxyKey: makeKey,
    proxyUnpack: payUnpack,
    proxyPack: payPack,
    proxySetPack: setPack,
    proxyUnsetPack: unsetPack,
  };

  // generates a proxy with an apply handler
  const makeApplyHandler = (target, prop) => {
    return new Proxy(target[prop], {
      apply(func, thisArgs, args) {
        return applyHandler(prop, func, thisArgs, args);
      },
    });
  };

  /**
   * the proxy for the redis client with hashing and packing enabled
   */
  const proxy = new Proxy(client, {
    // we'll be called here on every get to the client
    get(target, prop, receiver) {
      // the caller is after some of the proxy functions to use them independently
      if (Reflect.has(proxyExports, prop)) return proxyExports[prop];

      // if we get a fetch call, we'd like to send it back with the endpoint encapsulated
      // so that when it's applied, it will execute my version of the function
      if (typeof target[prop] === "function" && hashProps.has(propMap[prop])) {
        return makeApplyHandler(target, prop);
      } else {
        // not a function we want to intercept
        return Reflect.get(target, prop, receiver);
      }
    },
  });

  return testConnectivity ? testConnect({ client: proxy, useProxy }) : proxy;
};

// test connecttivity and return client
const testConnect = async ({ client, useProxy }) => {
  // use an object if useProxy, otherwise a string
  const key = useProxy ? { key: "bar" } : "s" + new Date().getTime();
  const data = useProxy ? { data: "foo is bar" } : "foo is bar";

  const addData = await client.set(key, data);
  const getData = await client.get(key);
  const delData = await client.del(key);
  const passed =
    addData === "OK" &&
    getData &&
    JSON.stringify(getData.value || {}) === JSON.stringify(data) &&
    delData === 1;
  if (!passed) {
    console.error(
      "...failed redis connectivity test",
      useProxy,
      addData,
      getData,
      delData
    );
  } else {
    console.log("...passed redis connectivity tests with useProxy", useProxy);
  }
  return client;
};

const multiGet = async ({ cacheKeys, redisProxy }) => {
  // the idea here is to do a massive cache get
  // and stick the results in a map
  const cacheMap = new Map(cacheKeys.map((k) => [k, null]));
  const multi = redisProxy.multi();

  // we can use the proxies own mechanism for generating valid hashed keys
  cacheKeys.forEach((key) => multi.get(key));

  // the results are of the format [ [err, value],...]
  const results = await multi.exec();

  // use the proxies method of unpacking data
  let index = 0;
  for await (const result of results) {
    const [error, v] = await result;

    if (error) {
      console.log(
        `...unexpected pipeline error for ${cacheKeys[index]}`,
        error
      );
    } else {
      const value = v === null ? null : await redisProxy.proxyUnpack(v);
      cacheMap.set(cacheKeys[index], value);
    }
    index++;
  }
  return cacheMap;
};

const cacheAge = (timestamp) =>
  timestamp ? 0 : new Date().getTime() - timestamp;

export default {
  cacheAge,
  multiGet,
  getRedisProxy,
  fetchConfig,
};
