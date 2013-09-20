const
amazonEc2 = require('awssum-amazon-ec2'),
amazonRoute53 = require('awssum-amazon-route53'),
NiceRoute53 = require('nice-route53'),
config = require('./config.js'),
jsel = require('JSONSelect');

function createEc2Client(region) {
  return new amazonEc2.Ec2({
    accessKeyId: process.env.AWS_ID,
    secretAccessKey: process.env.AWS_SECRET,
    region: region || amazonEc2.US_EAST_1, // default
  });
}

function createRoute53Client() {
  return new amazonRoute53.Route53({
    accessKeyId: process.env.AWS_ID,
    secretAccessKey: process.env.AWS_SECRET,
  });
}

function createNiceRoute53Client() {
  return new NiceRoute53({
    accessKeyId: process.env.AWS_ID,
    secretAccessKey: process.env.AWS_SECRET,
  });
}

// make an error from an Amazon error
exports.makeError = function(err) {
  var e;
  try {
    e = err.Body.Response.Errors.Error.Code + ": " + err.Body.Response.Errors.Error.Message;
  } catch(ex) { }
  return e || err;
};

// get an aws client instance for the specified region.
// if region is null, the default will be used.
exports.createClients = function(region) {
  region = region || config.region;

  // if any of AWS_ID, AWS_SECRET or AWS_REGION is wrong, then these will throw
  exports.client = createEc2Client(region);
  exports.route53 = createRoute53Client();
  exports.niceRoute53 = createNiceRoute53Client();

  return region;
};

exports.allocateEC2Client = function(region) {
  return createEc2Client(region);
};

exports.zones = function(cb) {
  exports.client.DescribeRegions(function(err, regions) {
    if (err) return cb(exports.makeError(err));
    var regionMap = {};
    var complete = 0;

    jsel.forEach('.regionInfo .item > *', regions, function(region) {
      // add this region to the regionMap (and used to check when all results have come back)
      regionMap[region.regionName] = {
        endpoint: region.regionEndpoint,
        zones: []
      };

      createEc2Client(region.regionName).DescribeAvailabilityZones({
        Filter : [ { Name : "region-name", Value : [ region.regionName ] } ]
      }, function(err, zones) {
        if (complete === -1) return;
        complete++;

        if (err) {
          complete = -1;
          return cb(exports.makeError(err));
        }

        jsel.forEach('.availabilityZoneInfo .item > *', zones, function(zone) {
          regionMap[region.regionName].zones.push({
            name: zone.zoneName,
            state: zone.zoneState
          });
        });

        // if we have finished, callback
        if (complete === Object.keys(regionMap).length) {
          cb(null, regionMap);
        }
      });
    });
  });
};
