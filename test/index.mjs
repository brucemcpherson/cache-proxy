import test from "ava";
import delay from "delay";

import { default as cache } from "../index.mjs";
const { getRedisProxy, fetchConfig } = cache;
import { getRedisConfigs } from "./helpers/redisconfig.mjs";

const getData = () => {
  return getRedisProxy({
    database: "local",
    extraConfig: "test",
    testConnectivity: true,
      redisConfigs: getRedisConfigs(),  
  }).then((p) => {
    const redisProxy = p;
    const config = fetchConfig();

    const hugeChunk = Array.from({
      length: config.maxChunk * 10,
    }).map(() => Math.random().toString());

    const smallChunk = Array.from({
      length: config.maxChunk,
    }).map(() => Math.random().toString());
    return {
      redisProxy,
      config,
      hugeChunk,
      smallChunk,
      baseKey: {
        proxyTest: new Date().getTime().toString() + "-" + Math.random(),
      },
    };
  });
};

test.before("setup test data and client", (t) => {
  return getData().then((y) => {
    t.context = y;
    t.not(t.context, null);
  });
});

test("basic packing", (t) => {
  const { redisProxy } = t.context;
  const fix = { abc: 1 };
  return redisProxy
    .proxyPack(fix)
    .then((x) => {
      const ob = JSON.parse(x);
      t.true(Reflect.has(ob, "p"));
      t.false(Reflect.has(ob, "z"));
      return redisProxy.proxyUnpack(x);
    })
    .then((y) => t.deepEqual(y.value, fix));
});

test("big packing", (t) => {
  const { redisProxy, config } = t.context;
  const fix = Array.from({ length: config.gzipThreshold + 1 }).fill("x");
  return redisProxy
    .proxyPack(fix)
    .then((x) => {
      const ob = JSON.parse(x);
      t.true(Reflect.has(ob, "z"));
      t.false(Reflect.has(ob, "p"));
      return redisProxy.proxyUnpack(x);
    })
    .then((y) => t.deepEqual(y.value, fix));
});

test("huge chunk", (t) => {
  const { redisProxy, hugeChunk, baseKey } = t.context;
  console.log(t.title);
  const key = { ...baseKey, title: t.title };

  return redisProxy
    .set(key, hugeChunk)
    .then((ok) => {
      t.is(ok, "OK");
      return redisProxy.get(key);
    })
    .then(({ value }) => {
      t.deepEqual(value, hugeChunk);
      return redisProxy.del(key);
    })
    .then((y) => t.is(y, 1));
});

test("small chunk", async (t) => {
  const { redisProxy, smallChunk, baseKey } = t.context;
  const key = { ...baseKey, title: t.title };

  return redisProxy
    .set(key, smallChunk)
    .then((ok) => {
      t.is(ok, "OK");
      return redisProxy.get(key);
    })
    .then(({ value }) => {
      t.deepEqual(value, smallChunk);
      return redisProxy.del(key);
    })
    .then((y) => t.is(y, 1));
});

test("redis basic", async (t) => {
  const { redisProxy, baseKey } = t.context;
  const fix = { xyz: [0, 1] };
  const key = { ...baseKey, title: t.title };

  return redisProxy
    .set(key, fix)
    .then((ok) => {
      t.is(ok, "OK");
      return redisProxy.get(key);
    })
    .then(({ value }) => {
      t.deepEqual(value, fix);
      return redisProxy.del(key);
    })
    .then((dok) => {
      t.is(dok, 1);
      return redisProxy.get(key);
    })
    .then((y) => t.is(y, null));
});

test("redis big", (t) => {
  const { redisProxy, config, baseKey } = t.context;
  const fix = Array.from({ length: config.gzipThreshold + 1 }).fill("y");
  const key = { ...baseKey, title: t.title };

  return redisProxy
    .set(key, fix)
    .then((ok) => {
      t.is(ok, "OK");
      return redisProxy.get(key);
    })
    .then(({ value }) => {
      t.deepEqual(value, fix);
      return redisProxy.del(key);
    })
    .then((dok) => {
      t.is(dok, 1);
      return redisProxy.get(key);
    })
    .then((y) => t.is(y, null));
});

test("redis chunking", (t) => {
  const { redisProxy, hugeChunk: fix, baseKey } = t.context;
  const key = { ...baseKey, title: t.title };

  return redisProxy
    .set(key, fix)
    .then((ok) => {
      t.is(ok, "OK");
      return redisProxy.get(key);
    })
    .then(({ value }) => {
      t.deepEqual(value, fix);
      return redisProxy.del(key);
    })
    .then((dok) => {
      t.is(dok, 1);
      return redisProxy.get(key);
    })
    .then((y) => t.is(y, null));
});

test("redis default expire", (t) => {
  const { redisProxy, hugeChunk: fix, config, baseKey } = t.context;
  const key = { ...baseKey, title: t.title };
  return redisProxy
    .set(key, fix)
    .then((ok) => {
      t.is(ok, "OK");
      return redisProxy.get(key);
    })
    .then((v) => {
      t.deepEqual(v.value, fix);
      return redisProxy.expiretime(v.hashedKey);
    })
    .then((y) =>
      t.is(y <= new Date().getTime() + config.expiration * 1000, true)
    );
});

test("redis explicit expire",  (t) => {
  const { redisProxy, smallChunk: fix, baseKey } = t.context;
  const key = { ...baseKey, title: t.title };
  const exSecs = 2;
  return redisProxy
    .set(key, fix, "EX", exSecs)
    .then((ok) => {
      t.is(ok, "OK");
      return redisProxy.get(key);
    })
    .then((v) => {
      t.deepEqual(v.value, fix);
      return redisProxy.expiretime(v.hashedKey);
    })
    .then((v) => {
      t.is(v <= new Date().getTime() + exSecs * 1000, true);
      return delay((exSecs + 1) * 1000).then(() => redisProxy.get(key));
    }).then (y=> t.is(y, null))

});
