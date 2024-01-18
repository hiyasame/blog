elog sync --force -e .env # 同步飞书上的博文到本地
git add .
git commit -m "update: $(date +"%Y-%m-%d %H:%M:%S")"
git push origin master