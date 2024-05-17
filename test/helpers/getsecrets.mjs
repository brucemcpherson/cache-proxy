export const getSecrets = ({name}) => {
  const secrets = process.env[name]
  if (!secrets) {
    console.log('.. did run . ./getsecrets.sh in your shell first')
    throw `${name} not set`
  }
  return JSON.parse (secrets)
}