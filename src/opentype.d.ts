// opentype.js ships without types; Iconic uses a small part of its API.
declare module 'opentype.js' {
  const opentype: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  export default opentype;
}
