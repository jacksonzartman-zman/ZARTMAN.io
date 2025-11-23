var value = Math.random() > 0.5 ? "ok" : null;
if (!value) {
    throw new Error("no value");
}
var value2 = value;
var acceptsString = function (input) { return input.toUpperCase(); };
acceptsString(value2);
