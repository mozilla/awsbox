const
aws = require('./aws.js'),
vm  = require('./vm.js');

exports.setState = function(id, state, cb) {
  var state = "" + state + "|" + (Math.floor(Date.now()/1000));
  vm.setTag(id, 'AWSBOX_REAP', state, cb);
};

exports.getState = function(instanceData) {

  try {
    var parts = instanceData.tags['AWSBOX_REAP'].split('|');

    if (parts.length !== 2) {
      throw new Error('well return the default');
    }

    var state = parseInt(parts[0], 10),
        last  = parseInt(parts[1], 10),
        deltaHours = Math.floor( (Date.now()/1000 - last) / 3600); // in hours

    return {
      state: state, 
      last: last,
      deltaHours: deltaHours
    };

  } catch(e) {
    return {
      state: 0, 
      last: 0,
      deltaHours: 0
    };
  }
};
