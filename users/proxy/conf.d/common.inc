    # serve ver.txt
    location /ver.txt {
      root /home/app;
    }

    # server awbox page
    error_page 502 /500/;
    location /500/ {
      root /home/proxy/;
    }
    location /awsbox_background.jpg {
      root /home/proxy/500;
    }

    # router
    location / {
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $http_host;
        proxy_set_header X-NginX-Proxy true;

        proxy_pass http://127.0.0.1:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        gzip on;
        gzip_disable "MSIE [1-6]\.(?!.*SV1)";
        gzip_proxied any;
        gzip_types application/javascript text/css;
    }
