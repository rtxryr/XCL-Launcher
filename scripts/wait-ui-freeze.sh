#!/bin/bash
# 等前端定稿：mtime 连续 180s 不变 + 含指定文案；最多 1500s
F="E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html"
UI="D:/workbuddy数据/2026-10-28-22-44-26/desktop-app/ui/index.html"
KEY="更新会覆盖安装目录中的同名程序文件"
start=$(date +%s)
last=""
lastchange=$(date +%s)
while true; do
  now=$(date +%s)
  m=$(stat -c '%Y:%s' "$F")
  if [ "$m" != "$last" ]; then
    last="$m"
    lastchange=$now
    echo "[$(date +%H:%M:%S)] front mtime/size -> $(stat -c '%y %s' "$F")"
  fi
  if grep -q "$KEY" "$F"; then has=1; else has=0; fi
  stable=$(( now - lastchange ))
  echo "[$(date +%H:%M:%S)] stable=${stable}s key=$has ui=$(stat -c '%y %s' "$UI")"
  if [ $stable -ge 180 ] && [ $has -eq 1 ]; then
    echo "READY $(sha256sum "$F")"
    break
  fi
  if [ $(( now - start )) -ge 1500 ]; then
    echo "TIMEOUT stable=$stable key=$has"
    break
  fi
  sleep 20
done
