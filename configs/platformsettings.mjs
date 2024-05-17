import gz from "node-gzip";
const { gzip, ungzip } = gz;
import hash from "object-hash";

export const platformSpecific = {
  zipper: gzip,
  unzipper: ungzip,
  toBase64: (str) => str.toString("base64"),
  fromBase64: (str) => Buffer.from(str, "base64"),
  makeKey: ({ prefix = "", key }) =>
    hash(
      { prefix, key },
      {
        encoding: "base64",
      }
    )
}


