const
aws = require('aws-lib'),
amazonEc2 = require('awssum-amazon-ec2');

function allocateClient(region) {
  return new amazonEc2.Ec2({
    accessKeyId: process.env['AWS_ID'],
    secretAccessKey: process.env['AWS_SECRET'],
    region: region || amazonEc2.US_EAST_1, // default
  });
}

// parse a response blob from amazon, return a string error if that response
// is an error response, null otherwise
exports.getError = function(respBlob) {
  var e;
  try { e = respBlob.Errors.Error.Code + ": " + respBlob.Errors.Error.Message } catch(ex) {};
  return e;
};

// make an error from an Amazon error
exports.makeError = function(err) {
  var e;
  console.log(err.Body.Response);
  try { e = err.Body.Response.Errors.Error.Code + ": " + err.Body.Response.Errors.Error.Message } catch(ex) {};
  return e || err;
};


// client, by default, is set to amazon default.  if setRegion is called,
// a new client will be allocated that will talk to a specific region's
// API endpoint.
exports.client = allocateClient();

// get an aws client instance for the specified region.
// if region is null, the default will be used.
exports.setRegion = function(region, cb) {
  if (typeof region === 'function') {
    cb = region;
    region = 'us-east-1';
  }

  // surely this is an error here, and if not, we're not passing anything to the cb???
  if (!region) return process.nextTick(cb);

  // let's turn the region into an endpoint
  exports.client.DescribeRegions( function(err, r) {
    if (err) return cb(exports.makeError(err));

    var endpoint;
    r.regionInfo.item.forEach(function(row) {
      if (row.regionName === region) {
        endpoint = row.regionEndpoint;
      }
    });

    if (endpoint) {
      exports.client = allocateClient(endpoint);
      cb(null, { region: region, endpoint: endpoint });
    } else {
      cb("no such region: " + region);
    }
  });
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

      allocateClient(region.regionName).DescribeAvailabilityZones({
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
