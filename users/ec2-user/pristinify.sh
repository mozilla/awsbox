#!/bin/sh

if [ $USER != "ec2-user" ]; then
    echo "this script must be run as the ec2-user"
    exit 1
fi

# revert a server back to a pristine state.  This is great to do before
# cutting an image

# stop running scripts under app user
if [ `sudo -u app -i /usr/local/bin/node node_modules/.bin/forever list | grep 'No forever processes' | wc -l` == "0" ]; then
    echo ">> Stopping running servers"
    sudo -u app -i /usr/local/bin/node node_modules/.bin/forever stopall
fi

# remove /tmp crap
sudo rm -rf /tmp/*

# remove system logs
sudo find /var/log -type f | sudo xargs --no-run-if-empty /bin/rm -fv

# reinitialize git
sudo -u app rm -rf /home/app/git
sudo -u app mkdir /home/app/git
GIT_DIR=/home/app/git sudo -u app -E git init --bare
sudo -u app ln -s /home/app/post-update.js /home/app/git/hooks/post-update
sudo -u app rm -f /home/app/ver.txt

# remove and recreate /home/app/var
sudo -u app rm -rf /home/app/{code,code.old,var,tmp}
sudo -u app -i git reset --hard HEAD

# re-initialize SSL keys
sudo -u proxy rm /home/proxy/{cert,key}.pem
sudo -u proxy -i /home/proxy/gen_self_signed.sh

# cut ourself off at the knees
# This is now part of `./awsbox.js createami ...`
#truncate -s 0 ~/.ssh/authorized_keys

# clean out proxy logs
sudo find /home/proxy/var/log -type f | sudo xargs --no-run-if-empty /bin/rm -fv
sudo -u proxy -i git reset --hard HEAD

# remove command history
sudo rm -f ~{app,ec2-user,proxy}/.bash_history
sudo find /home/ec2-user/.emacs.d -type f | sudo xargs --no-run-if-empty /bin/rm -fv

# remove packages installed at creation time
if [ -f $HOME/packages.txt ] ; then
  for pkg in `cat $HOME/packages.txt` ; do
      sudo yum -y remove $pkg
  done

  rm $HOME/packages.txt
fi

# remove databases, if created
sudo rm -rf /var/lib/mysql
