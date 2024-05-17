import {platformSpecific} from './platformsettings.mjs'

// this could vary depending on platform
const redisPropMap = {
  set: 'set',
  get: 'get',
  del: 'del'
}

// configs specific to redis
const redisPlatform = {
  propMap: redisPropMap,
  ...platformSpecific,
  gzip: true,
  gzipThreshold: 800
}

export const cacheSettings = {

  redis: {
    expiration: 28 * 24 * 60 * 60,
    prefix: 'prod',
    maxChunk: Infinity,
    ...redisPlatform
  },

  test: {
    expiration: 2 * 60 * 60,
    prefix: 'test',
    maxChunk: 999,
    ...redisPlatform
  }
}

