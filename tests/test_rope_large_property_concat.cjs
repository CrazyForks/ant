function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class Writer {
  constructor() {
    this.output = '';
  }

  write(chunk) {
    this.output += chunk;
  }
}

const writer = new Writer();
let snapshot = '';

for (let i = 0; i < 500_000; i++) {
  writer.write('abc');
  if (i === 99_999) snapshot = writer.output;
}

assert(snapshot.length === 300_000, 'retained rope snapshot length changed');
assert(snapshot.slice(0, 6) === 'abcabc', 'retained rope snapshot prefix changed');
assert(snapshot.slice(-6) === 'abcabc', 'retained rope snapshot suffix changed');

assert(writer.output.length === 1_500_000, 'large property concatenation length changed');
assert(writer.output.slice(0, 6) === 'abcabc', 'large property concatenation prefix changed');
assert(writer.output.slice(-6) === 'abcabc', 'large property concatenation suffix changed');

console.log('large property rope concatenation: ok');
