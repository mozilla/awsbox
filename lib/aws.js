const
aws = require('aws-lib');

function allocateClient(endpoint) {
  return aws.createEC2Client(process.env['AWS_ID'], process.env['AWS_SECRET'], {
    version: '2011-12-15',
    host: endpoint
  });
}

// parse a response blob from amazon, return a string error if that response
// is an error response, null otherwise
exports.getError = function(respBlob) {
  var e;
  try { e = respBlob.Errors.Error.Code + ": " + respBlob.Errors.Error.Message } catch(ex) {};
  return e;
};

// client, by default, is set to amazon default.  if setRegion is called,
// a new client will be allocated that will talk to a specific region's
// API endpoint.
exports.client = allocateClient(null);

// get an aws client instance for the specified region.
// if region is null, the default will be used.
exports.setRegion = function(region, cb) {
  if (typeof region === 'function') {
    cb = region;
    region = null;
  }

  if (!region) return process.nextTick(cb);

  // let's turn the region into an endpoint
  exports.client.call('DescribeRegions', {}, function(r) {
    if (exports.getError(r)) return cb(exports.getError(r));
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
  exports.client.call('DescribeRegions', {}, function(r) {
    if (exports.getError(r)) return cb(exports.getError(r));
    var regionMap = {};
    var complete = 0;
    r.regionInfo.item.forEach(function(row) {
      regionMap[row.regionName] = {
        endpoint: row.regionEndpoint,
        zones: []
      };
      allocateClient(row.regionEndpoint).call('DescribeAvailabilityZones', {
        "Filter.1.Name": "zone-name",
        "Filter.1.Value.1": row.regionName + "*"
      }, function(r) {
        if (complete === -1) return;
        complete++;
        if (exports.getError(r)) {
          complete = -1;
          return cb(exports.getError(r));
        }
        if (r.availabilityZoneInfo && r.availabilityZoneInfo.item && r.availabilityZoneInfo.item.length) {
          r.availabilityZoneInfo.item.forEach(function(zone) {
            regionMap[row.regionName].zones.push({
              name: zone.zoneName,
              state: zone.zoneState
            });
          });
        }
        if (complete === Object.keys(regionMap).length) {
          cb(null, regionMap);
        }
      });
    });
  });
};
