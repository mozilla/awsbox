const fs = require('fs');

exports.get = function() {
  try {
    var awsboxJson = JSON.parse(fs.readFileSync("./.awsbox.json"));
  } catch(e) {
    checkErr("Can't read awsbox.json: " + e);
  }

  return awsboxJson;
}



