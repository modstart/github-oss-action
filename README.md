# Github Action for OSS Upload

使用断点续传，可以上传大文件到 OSS

## Inputs

## 必须

- `title`: 打包说明
- `key-id`: OSS AccessKeyId
- `key-secret`: OSS AccessKeySecret
- `region`: 区域，如 `oss-cn-shenzhen`，和 `endpoint` 二选一
- `endpoint`: 优先级高于 `region`，可填写内网节点、加速节点，和 `region` 二选一。**建议显式使用 `https://` 前缀**（如 `https://oss-cn-hangzhou.aliyuncs.com`），GitHub 托管 Runner 位于海外，通过 HTTP(80) 连接国内 OSS 节点容易超时
- `bucket`: Bucket 名称
- `assets`: 上传的资源。每行一条规则，格式：
  - 一个冒号：`源路径.zip:目标路径.zip`
  - 一个冒号：`源路径/:目标路径/`（上传目录，保留目录结构）
  - 两个冒号：`源路径.zip:目标路径.zip:强制下载文件名.zip`（第三部分指定下载时强制保存的文件名）
  - 使用占位符：`code/*.zip:temp/{random}.zip:{name}.zip`（支持文件通配符和占位符）
    - `{random}` - 8位随机字符串（确保文件名唯一性）
    - `{name}` - 源文件名（不含扩展名）
- `timeout`: 可选，单次上传请求超时时间，默认 3600，单位：秒。上传失败会自动断点续传重试 5 次；若最终仍失败，任务会失败退出，**不会**触发回调
- `callback`: 可选，上传完成后的回调地址，上传完成后会以 `GET` 请求的方式调用该地址
- `callbackTitle`: 可选，回调时作为独立的查询参数发送的标题
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
      d.zip:/remote-d/d.zip:download.zip
      code/*.zip:temp/{random}.zip:{name}.zip
```

## 高级功能

### 占位符支持

在目标路径和强制下载文件名中支持占位符，用于动态生成文件名：

**示例：**
```yaml
assets: |
  code/*.zip:temp/{random}.zip:{name}.zip
```

**占位符说明：**
- `{random}` - 生成8位随机字母数字字符串（如：`a1b2c3d4`）
- `{name}` - 源文件名不含扩展名（如：`app`）

**处理示例：**
- 源文件：`code/app.zip`
- 目标路径：`temp/a1b2c3d4.zip`（随机字符串替换 `{random}`）
- 强制下载名：`app.zip`（`{name}.zip` 替换为 `app.zip`）

每个文件会生成独立的随机字符串，确保不会覆盖已存在的文件。

### 上传回调

这个参数可以用来通知上传完成，如果 `callback` 参数不为空，上传完成后会以 `GET` 请求的方式调用该地址，参数如下：

```
GET https://www.example.com/callback?data={"file1":"url1","file2":"url2"}
```

如果设置了 `callbackTitle` 参数，会作为独立的查询参数 `title` 添加：

```
GET https://www.example.com/callback?data={"file1":"url1","file2":"url2"}&title=My%20Upload%20Title
```

其中 `url1` 和 `url2` 是上传后的文件地址，会自动使用 `callbackUrlExpire` 参数设置的有效期生成临时地址。

## 说明

Fork from [tvrcgo/oss-action](https://github.com/tvrcgo/oss-action)
