# Github Action for OSS

使用断点续传，可以上传大文件到 OSS

## Inputs

- `key-id`: OSS AccessKeyId
- `key-secret`: OSS AccessKeySecret
- `region`: 区域，如 `oss-cn-shenzhen`，和 endpoint 二选一
- `endpoint`: 优先级高于 region，可填写内网节点、加速节点，和 region 二选一
- `bucket`: Bucket 名称
- `assets`: 上传的资源。每行一条规则，格式：`源路径:目标路径`
- `timeout`: 超时时间（可选），默认 600，单位：秒

## Outputs

- `none`

## Usage

```yaml
- name: Upload to OSS
  uses: modstart/github-oss-action@master
  with:
    key-id: ${{ secrets.OSS_KEY_ID }}
    key-secret: ${{ secrets.OSS_KEY_SECRET }}
    region: ${{ secrets.OSS_REGION }}
    bucket: ${{ secrets.OSS_BUCKET }}
    assets: |
      a/**:/remote-a/
      b/**:/remote-b/
      c.txt:/rc.txt
```

## 说明

Fork from [tvrcgo/oss-action](https://github.com/tvrcgo/oss-action)
