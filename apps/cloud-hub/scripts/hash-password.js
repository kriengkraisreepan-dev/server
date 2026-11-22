'use strict';

// Print an ADMIN_PASSWORD_HASH for the owner login. Reads the password from stdin so it is
// not left in shell history:  echo -n 'my long password' | npm run -s hash-password
const { hashPassword } = require('../src/admin/auth');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  try {
    console.log(hashPassword(input.replace(/\r?\n$/, '')));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
