const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');

async function getm3u8(m3u8Url, fileDir) {

    let response = await axios.get(m3u8Url)
    fs.writeFileSync(path.join(__dirname, fileDir, `data.m3u8`), response.data, "utf-8")
    return response.data

}

async function getkey(keyUri, userid) {
    let url = keyUri + '&uid=' + userid
    console.log(url);
    let response = await axios.get(url)
    return response.data
}

function xorKeys(key1, userid) {
    // 确保两个密钥的长度相同

    // 将密钥转换为数组
    const key1Array = Array.from(key1);
    const key2Array = Array.from(userid);

    // 对每个字节进行异或操作
    const resultArray = key1Array.map((byte, index) => byte.charCodeAt(0) ^ key2Array[index].charCodeAt(0));

    // 将结果转换回字符串
    const result = String.fromCharCode(...resultArray);

    return result;
}

async function downloadTS(fileurl, savefilepath) {
    let dir = path.dirname(savefilepath)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir)
    } 
    
    let url = `https://v-vod-k.xiaoeknow.com/.../${fileurl}?&sign=***&t=***&us=***`
    console.log(url);
    return new Promise((resolve, reject) => {
        axios({
            method: 'get',
            url: url,
            responseType: 'stream', // 设置响应类型为流
        }).then(response => {
            // 将响应流直接写入文件
            response.data.pipe(fs.createWriteStream(savefilepath));

            // 监听完成事件
            response.data.on('end', () => {
                console.log('文件下载完成');
                resolve('finish')
            });
        }).catch(error => {
            console.error('下载文件时发生错误:', error.message);
        });
    })


}

function decode(secret_key, rawfilepath, savefilepath) {

    let dir = path.dirname(savefilepath)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir)
    } 

    // 读取密文的TS分片
    const encryptedFilePath = rawfilepath;
    const encryptedData = fs.readFileSync(encryptedFilePath);

    // 定义密钥
    const key = Buffer.from(secret_key, 'utf8');

    // 创建解密器
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0));

    // 解密数据
    const decryptedData = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

    // 写入解密后的数据
    const decryptedFilePath = savefilepath;
    fs.writeFileSync(decryptedFilePath, decryptedData);

    console.log('解密完成，输出文件:', decryptedFilePath);

}

async function main() {
    let userid = 'u_******'

    let fileDir = "DIR_NAME"
    // 获取m3u8文件
    
    let m3u8Url = "https://pri-cdn-tx.xiaoeknow.com/.../***.m3u8?sign=***&t=***"
    let m3u8 = await getm3u8(m3u8Url, fileDir)

    // 获取所有ts文件url
    const tsUrls = m3u8.match(/(\/?[a-zA-Z0-9-._~%!$&'()*+,;=:@]+\.ts)/g);
    // console.log(tsUrls);

    // 获取密钥地址
    const keyUriMatches = m3u8.match(/#EXT-X-KEY:.*?\bURI="(.*?)"/);
    const keyUri = keyUriMatches[1]

    // 获取密钥
    let key = await getkey(keyUri, userid)
    console.log(key);

    // 获取解密的密钥
    const decryptedKey = xorKeys(key, userid);
    console.log('解密后的密钥:', decryptedKey);
    
    for (let i = 0; i < tsUrls.length; i++) {
        const filename = tsUrls[i];
        await downloadTS(filename, path.join(__dirname, fileDir, 'download', filename))
        await decode(decryptedKey, path.join(__dirname, fileDir, 'download', filename), path.join(__dirname, fileDir, 'decode', filename))

        let str = `file '${filename}'\n`
        fs.appendFileSync(path.join(__dirname, fileDir, 'decode', "filelist.txt"), str, "utf-8")
    }

    // decode(decryptedKey)

    console.log('finish')
}

main()
