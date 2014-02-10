## How do I create a new base image?

awsbox creates an instance of your application by first creating a server
from an awsbox machine image.  This image is pre-configured with nginx, node.js,
git publishing, and more.

The base image is creating using [cdist][], and you can yourself build a custom
image to make whatever changes you desire.  Here's the steps:

[cdist]: http://www.nico.schottelius.org/software/cdist/

### 1. Create a new VM

First create a new VM using the amazon console.  The only requirement is that the
image is accessible by root via ssh without a password.  To make this possible
on an amazon AMI you need to make some changes:

1. uncomment `PermitRootLogin yes` in /etc/ssh/sshd_config
2. restart sshd with `/etc/init.d/sshd restart`
3. modify `~root/.ssh/authorized_keys` and remove the first part of the line that
   tells you to log in as the ec2-user

Verify you can ssh in as root, and you're done.  Here's a little script that you
can paste in as ec2-user to accomplish the above:

    sudo sed -i s/^#PermitRoot/PermitRoot/ /etc/ssh/sshd_config
    sudo /etc/init.d/sshd restart
    sudo sed -i s/^.*ssh-rsa/ssh-rsa/ /root/.ssh/authorized_keys

### 2. get cdist

[cdist][] is a lightweight alternative to tools like [chef][] and [puppet][].  To
use it, you need python 3 installed on your system.

  [chef]: http://www.getchef.com/
  [puppet]: http://puppetlabs.com

Next, you should get [version 3.0.7 of cdist][].

  [version 3.0.7 of cdist]:  https://codeload.github.com/telmich/cdist/tar.gz/3.0.7

you can put this wherever you want, simple is good, try this:

    curl https://codeload.github.com/telmich/cdist/tar.gz/3.0.7 | tar xz

### 3. provision your server

Using cdist, you can now provision the server you created in #2:

    cdist-3.0.7/bin/cdist config -v -c .cdist <server ip>

### 4. Create a new base image and update the AMI list

    ./awsbox.js createami <instance id>

This is going to take a while...  First this will create an image.  Next it will
copy that AMI into all availability zones, and finally it will write out the
region specific AMI IDs to the JSON file `defaultImages.json`.

A successful result will be a local modification to defaultImages.

### Now test!

Final step, test to see that this works as you want.  You can npm install your
modified awsbox into one of your projects, or you can just try creating a new
vm.  When satisfied, commit!  Now you've got a commit that uses new base amis.
