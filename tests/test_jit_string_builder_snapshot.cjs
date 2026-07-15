function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: got ${actual}, expected ${expected}`);
  }
}

function localSnapshot() {
  let value = '';
  for (let i = 0; i < 8; i++) value += 'x';

  const snapshot = value;
  value += 'y';
  return snapshot + ':' + value;
}

function parameterSnapshot(value) {
  for (let i = 0; i < 8; i++) value += 'x';

  const snapshot = value;
  value += 'y';
  return snapshot + ':' + value;
}

function capturedSnapshot() {
  let value = '';
  function read() {
    return value;
  }

  for (let i = 0; i < 8; i++) value += 'x';

  const snapshot = read();
  value += 'y';
  return snapshot + ':' + value;
}

const expected = 'xxxxxxxx:xxxxxxxxy';
for (let i = 0; i < 300; i++) {
  assertEq(localSnapshot(), expected, `hot local snapshot ${i}`);
  assertEq(parameterSnapshot(''), expected, `hot parameter snapshot ${i}`);
  assertEq(capturedSnapshot(), expected, `hot captured snapshot ${i}`);
}

function osrSnapshot() {
  let value = '';
  let snapshot = '';

  for (let i = 0; i < 8_000; i++) {
    value += 'x';
    if (i === 1_999) snapshot = value;
  }

  return snapshot.length + ':' + value.length;
}

assertEq(osrSnapshot(), '2000:8000', 'OSR local snapshot');

console.log('OK: test_jit_string_builder_snapshot');
