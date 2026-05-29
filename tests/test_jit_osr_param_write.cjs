const assert = require('assert');

function readOption(_input, options) {
  options = Object.assign({}, { checkHeader: true }, options);

  let seen = 0;
  for (let i = 0; i < 600; i++) {
    if (!options.checkHeader) throw new Error('lost reassigned parameter');
    seen++;
  }
  return seen;
}

assert.strictEqual(readOption({ length: 1000 }), 600);
