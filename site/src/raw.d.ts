/** Vite's `?raw` import of a file as its text, which the help test uses to read index.html. */
declare module "*?raw" {
  const text: string;

  export default text;
}
