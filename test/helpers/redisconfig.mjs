import {getSecrets} from "./getsecrets.mjs"
export const getRedisConfigs = () => getSecrets({name: "REDIS_SECRETS"}).redisConfigs
