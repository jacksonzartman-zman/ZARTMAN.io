var value = Math.random() > 0.5 ? "ok" : null;
if (!value) {
    throw new Error("no value");
}
var str = value;
