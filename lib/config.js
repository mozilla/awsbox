const fs = require('fs');

exports.get = function() {
  try {
    var awsboxJson = JSON.parse(fs.readFileSync("./.awsbox.json"));
  } catch(e) {
    process.stderr.write('ERRORE FATALE: ' + e + "\n");
    process.exit(1);
  }

  return awsboxJson;
}



