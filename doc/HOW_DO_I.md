# How Do I XXX in awsbox?

This is a cookbook of how to Get Common Things Done with
awsbox.

## How Do I Push Code?

If you use awsbox from an existing project, a git "remote" will
be added for you with the name of the machine you chose (with the
-n flag).

## How Do I Check My Server Logs?

    $ ssh app@[ip address] 'tail -F var/log/*'

## How Do I Restart My Server?

    $ ssh app@[ip address] 'forever restartall'

## How Do I Give Other People Access to the VM?

Add their key to `~ec2-user/.ssh/authorized_keys` to give access to
administer the machine and the app.

Alternately, to only give app access, turn the symlink in
`~app/.ssh/authorized_keys` to a real file, and add your buddy's key
there:

    $ cp -L ~/.ssh/authorized_keys ~/.ssh/foo && mv .ssh/foo .ssh/authorized_keys
    $ # now add the key

## How Do I Install Software?

Use yum.

    $ ssh ec2-user@[ip address]
    $ yum search memcached
    $ yum install memcached.x86_64

