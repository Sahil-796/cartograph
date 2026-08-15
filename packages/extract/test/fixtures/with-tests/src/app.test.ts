import { greet } from "./app.js";

// A call to an in-repo symbol, but from a test — must NOT enter the call
// graph or the resolution metric, even though `greet` is a known symbol.
it("greets", () => {
  greet("test");
});
