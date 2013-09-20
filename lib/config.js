const fs = require('fs'),
path = require('path');

exports.get = function() {
  var awsboxJson;
  try {
    awsboxJson = JSON.parse(fs.readFileSync("./.awsbox.json"));
  } catch(e) {
    process.stderr.write('ERRORE FATALE: ' + e + "\n");
    process.exit(1);
  }

  return awsboxJson;
};

exports.region = process.env.AWS_REGION || 'us-east-1';

exports.defaultImagesPath = path.join(__dirname, '..', "defaultImages.json");

exports.getDefaultImageId = function() {
  var images;
  try {
    images = JSON.parse(fs.readFileSync(exports.defaultImagesPath));
  } catch(e) {
    throw new Error("can't read default images file: " +
                    exports.defaultImagesPath + ": " +
                    e.toString());
  }
  if (!images[exports.region]) {
    throw new Error("no AMI for region: " + exports.region);
  }
  return images[exports.region];
};
