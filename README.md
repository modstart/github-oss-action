# Github Action for OSS Upload

使用断点续传，可以上传大文件到 OSS

## Inputs

## 必须

- `title`: 打包说明
- `key-id`: OSS AccessKeyId
- `key-secret`: OSS AccessKeySecret
- `region`: 区域，如 `oss-cn-shenzhen`，和 `endpoint` 二选一
- `endpoint`: 优先级高于 `region`，可填写内网节点、加速节点，和 `region` 二选一
- `bucket`: Bucket 名称
- `assets`: 上传的资源。每行一条规则，格式：`源路径:目标路径`
- `timeout`: 可选，上传超时时间，默认 3600，单位：秒
- `callback`: 可选，上传完成后的回调地址，上传完成后会以 `GET` 请求的方式调用该地址
- `callbackUrlExpire`: 可选，回调地址的有效期，默认 604800（7 天），单位：秒

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

## 高级功能

### 上传回调

这个参数可以用来通知上传完成，如果 `callback` 参数不为空，上传完成后会以 `GET` 请求的方式调用该地址，参数如下：

```
GET https://www.example.com/callback?data={"file1":"url1","file2":"url2"}
```

其中 `url1` 和 `url2` 是上传后的文件地址，会自动使用 `callbackUrlExpire` 参数设置的有效期生成临时地址。

## 说明

Fork from [tvrcgo/oss-action](https://github.com/tvrcgo/oss-action)
