## How do I create a new base image?

You may want to contribute an update to awsbox, or you may want a custom
base image.  Either way, here's the set of steps to follow to create
a new base image.

### 1. Create a new VM

    ./awsbox.js create -t c1.medium -n awsupdate

This step will create a new awsbox from the current machine image.  As part
of that it will install the latest security updates (awsbox is kinda paternal
that way - at machine creation, it will always install latest updates for you).

**NOTE:** I often choose a c1.medium instance or larger for building new base
images - because they are faster.  They're also more expensive, but typically
short lived.

At the conclusion of this step, you'll have a new awsbox sitting in your
aws account.

### 2. Do whatever you need to do!

You may want a different version of node, you may want to change some behaviors
in the base image, you may want to do a myriad of things.

Once complete, you can move onto step 3 - but if you're curious how to update
node (a pretty common thing to want to do), read on.

So to update node, we'll first ssh in as the ec2-user:

    ssh ec2-user@myawsboxip

Next, let's download the version of node we want to install:

    wget http://nodejs.org/dist/v0.10.24/node-v0.10.24.tar.gz

After that, we'll unpack, configure and install node:

    $ tar xvzf node-v0.10.24.tar.gz
    $ cd node-v0.10.24
    $ ./configure
    $ make -j4
    $ sudo make install

Now that node is installed, we need to make sure that all node libraries that
were compiled against the previous version of node will still run.  That's pretty
simple - from your computer, do this:

    $ ssh app@myawsboxip 'npm rebuild'

This command will log you in as the `app` user (the user under whom applications
run), and will rebuild all of the binary components used by node as that user.

All done!  You're ready to move on...

### 3. Create a new base image and update the AMI list

    ./awsbox.js createami

This is going to take a while...  First this command will clean up the image,
undoing specific configuration, removing command history, etc.  Next it will
copy that AMI into all availability zones, and finally it will write out the
region specific AMI IDs to the JSON file `defaultImages.json`.

A successful result will be a local modification to defaultImages.

### Now test!

Final step, test to see that this works as you want.  You can npm install your
modified awsbox into one of your projects, or you can just try creating a new
vm.  When satisfied, commit!  Now you've got a commit that you can build off of
that uses your custom AMI.  (or you can send an upstream pull request).



