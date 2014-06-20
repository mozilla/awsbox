## How do I create a new base image?

awsbox creates an instance of your application by first creating a server
from an awsbox machine image.  This image is pre-configured with nginx, node.js,
git publishing, and more.

The base image is created using [cdist][], and you can yourself build a custom
image to make whatever changes you desire.  Here's the steps:

[cdist]: http://www.nico.schottelius.org/software/cdist/

You could run all of these instructions locally but a good idea is to boot up an
extra EC2 instance and run it from there - essentially this will be quicker than
from your local machine.

### 1. Create a new VM

First create a new VM using the Amazon Console by using the default stock Amazon
Linux AMI 2014.03.2 (or later) 64 bit and make sure it is the PV
(Para-Virtualisation) version, not the HVM (Hardware-assited Virtual Machine)
version. This is usually at top of the AMI list of standard AMIs.

The only requirement is that the image is accessible by root via ssh without a
password.  To make this possible on an amazon AMI you need to make some changes:

1. uncomment `PermitRootLogin yes` in /etc/ssh/sshd_config
2. uncomment `StrictModes yes` in /etc/ssh/sshd_config (which is the default, but will be set to `no` in step 3)
3. restart sshd with `/etc/init.d/sshd restart`
4. modify `~root/.ssh/authorized_keys` and remove the first part of the line that
   tells you to log in as the ec2-user

Verify you can ssh in as root, and you're done.  Here's a little script that you
can paste in as `ec2-user` to accomplish the above:

    sudo sed -i s/^#PermitRoot/PermitRoot/ /etc/ssh/sshd_config
    sudo sed -i s/^#StrictModes/StrictModes/ /etc/ssh/sshd_config
    sudo /etc/init.d/sshd restart
    sudo sed -i s/^.*ssh-rsa/ssh-rsa/ /root/.ssh/authorized_keys

Now logout of the VM, and continue with step 2 on your local system.

### 2. get cdist

[cdist][] is a lightweight alternative to tools like [chef][] and [puppet][].  To
use it, you need [python 3] installed on your system.

  [chef]: http://www.getchef.com/
  [puppet]: http://puppetlabs.com
  [python 3]: https://www.python.org/download/

Next, you should get [version 3.0.7 of cdist][].

  [version 3.0.7 of cdist]:  https://codeload.github.com/telmich/cdist/tar.gz/3.0.7

you can put this wherever you want, simple is good, try this:

    curl https://codeload.github.com/telmich/cdist/tar.gz/3.0.7 | tar xz

Or:

    git clone git://git.schottelius.org/cdist
    cd cdist
    export PATH=$PATH:$(pwd -P)/bin
    cd ..

Note: cdist version 3.1.5 is also known to work.

### PRO TIP: make ssh faster

Our friends who created cdist [suggest a way][] to make sequential ssh sessions much faster:

  [suggest a way]: http://www.nico.schottelius.org/software/cdist/man/latest/man7/cdist-best-practice.html#_speeding_up_ssh_connections

Just put this in your `~/.ssh/config`:

    Host *
         ControlPath ~/.ssh/master-%l-%r@%h:%p
         ControlMaster auto
         ControlPersist 10

### 3. provision your server

Using cdist, you can now provision the server you created in #1 above. From the awsbox repo directory:

    /path/to/cdist-3.0.7/bin/cdist config -v -c .cdist <server public ip>

Once this has finished, you should run the pristinify script on the instance
to make sure various services are stopped, some files are deleted and logs
removed. As the `ec2-user`:

    ~/pristinify.sh

### 4. Create a new base image and update the AMI list

Firstly, export which region your instance is in:

    REGION=es-west-2
    ./awsbox.js createami <instance id>

This is going to take a while...  First this will create an image.  Next it will
copy that AMI into all availability zones, and finally it will write out the
region specific AMI IDs to the JSON file `defaultImages.json`.

e.g.

    $ ./awsbox.js createami i-deadbeef
    ...etc...
    AMIs created: { 'us-west-2': 'ami-391e6209',
      'us-west-1': 'ami-192a2c5c',
      'ap-northeast-1': 'ami-c52d66c4',
      'us-east-1': 'ami-d4f20bbc',
      'eu-west-1': 'ami-aff931d8',
      'ap-southeast-2': 'ami-9d791da7',
      'sa-east-1': 'ami-259c3338',
      'ap-southeast-1': 'ami-be530cec' }

A successful result will be a local modification to defaultImages.

### Now test!

Final step, test to see that this works as you want.  You can npm install your
modified awsbox into one of your projects, or you can just try creating a new
vm.  When satisfied, commit!  Now you've got a commit that uses new base amis.

