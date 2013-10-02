const
aws = require('./aws.js'),
jsel = require('JSONSelect'),
key = require('./key.js');

// every time you change the security group, change this version number
// so new deployments will create a new group with the changes
const SECURITY_GROUP_VERSION = 1;

function createError(msg, r) {
  var m = jsel.match('.Message', r);
  if (m.length) msg += ": " + m[0];
  return msg;
}

exports.getName = function(name, cb) {
  var groupName = name || "awsbox group v" + SECURITY_GROUP_VERSION;

  // is this fingerprint known?
  aws.client.DescribeSecurityGroups({
    GroupName: groupName
  }, function(err, r) {
    // if the security group does not exist, let's create it automatically
    if (err && jsel.match('.Code:val("InvalidGroup.NotFound")', err).length) {
      // CreateSecurityGroup
      aws.client.CreateSecurityGroup({
        GroupName: groupName,
        GroupDescription: 'A security group for awsbox deployments'
      }, function(err) {
        if (err) {
          return cb(createError('failed to create security group', err));
        }
        // AuthorizeSecurityGroupIngress
        aws.client.AuthorizeSecurityGroupIngress({
          GroupName : groupName,
          IpPermissions : [
            {
              IpProtocol: "tcp",
              FromPort: 80,
              ToPort: 80,
              IpRanges: [ { CidrIp: "0.0.0.0/0" } ],
            },
            {
              IpProtocol: "tcp",
              FromPort: 22,
              ToPort: 22,
              IpRanges: [ { CidrIp: "0.0.0.0/0" } ],
            },
            {
              IpProtocol: "tcp",
              FromPort: 443,
              ToPort: 443,
              IpRanges: [ { CidrIp: "0.0.0.0/0" } ],
            },
          ],
        }, function(err) {
          if (err) return cb(createError('failed to create security group', err));
          cb(null, groupName);
        });
      });
    } else if (err) {
      return cb(createError('failed to describe security groups', err));
    } else {
      // already exists?
      var m = jsel.match('.securityGroupInfo > .item > .groupName', r);
      if (m.length && m[0] === groupName) return cb(null, groupName);
      cb(createError('error creating group', r));
    }
  });
};
