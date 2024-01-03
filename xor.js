const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');

/**
 * @description 检查路径是否存在，如果不存在，则创建它。
 * @param {String} dirPath - 需要检查或创建的路径。
 */
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {

        if (path.extname(dirPath)) {
            const dir = path.dirname(dirPath);
            ensureDirectoryExists(dir)

            fs.writeFileSync(dirPath, "")
            console.log(`创建文件：${dirPath}`);
        }
        else {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`创建目录：${dirPath}`);
        }
    } else {
        console.log(`已存在：${dirPath}`);
    }
}

/**
 * @description 获取m3u8文件内容 并保存
 * @param {URL} m3u8Url m3u8文件下载的完整URL
 * @param {String} fileDir m3u8文件保存的文件夹路径
 * @returns {String} m3u8文件内容
 */
async function getm3u8(m3u8Url, fileDir) {
    let response = await axios.get(m3u8Url)
    fs.writeFileSync(path.join(__dirname, fileDir, `data.m3u8`), response.data, "utf-8")
    console.log(`已保存：${path.join(__dirname, fileDir, `data.m3u8`)}`)
    return response.data
}

/**
 * @description 根据m3u8内容，获取偏移量IV
 * @param {m3u8} m3u8Content 通过 getm3u8() 获取
 * @returns {Buffer} 偏移量 IV
 */
function getIV(m3u8Content) {
    const ivRegex = /#EXT-X-KEY:.*?IV=0x([0-9A-Fa-f]+)/;
    const match = m3u8Content.match(ivRegex);

    if (match) {
        const iv = match[1];
        console.log("Extracted IV:", iv);
        return Buffer.from(iv, 'hex')
    } else {
        console.log("IV not found");
        return Buffer.alloc(16, 0)
    }
}

/**
 * @description 获取所有TS文件的完整的URL地址
 * @param {m3u8} m3u8Content 通过 getm3u8() 获取
 * @param {URL} tsUrldemo 任意一个ts文件的下载地址
 * @returns {Array} 所有ts分片URL
 */
function getTSList(m3u8Content, tsUrldemo) {
    function parseUrl(url) {
        const urlObj = new URL(url);

        // 获取 base 部分
        const baseUrl = urlObj.origin;

        // 获取文件部分
        const filePath = urlObj.pathname;

        // 分离路径和文件名
        const pathSegments = filePath.split('/');
        const path = pathSegments.slice(0, -1).join('/');
        const fileName = pathSegments.slice(-1)[0];

        // 获取参数部分
        const queryParams = parseUri(urlObj.search).params;

        return {
            base: baseUrl,
            path: path,
            fileName: fileName,
            params: queryParams,
        };
    }
    function parseUri(str) {
        const [fileName, paramString] = str.split('?');

        // 初始化一个对象，用于存储参数键值对
        const params = {};

        // 如果存在参数部分
        if (paramString) {
            // 将参数字符串分割成键值对数组
            const paramPairs = paramString.split('&');

            // 遍历键值对数组，并将其解析为对象
            for (const pair of paramPairs) {
                if (pair == "") continue
                const [key, value] = pair.split('=');
                params[key] = value;
            }
        }

        return { fileName, params };
    }
    function objectToQueryString(obj) {
        // 将对象的键值对转换为查询字符串形式
        const queryString = Object.entries(obj).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
        return queryString;
    }

    let list = m3u8Content.match(/^.+\.ts.*/gm);
    let demoURLObj = parseUrl(tsUrldemo)

    for (let i = 0; i < list.length; i++) {
        const uri = list[i];
        let uriObj = parseUri(uri)

        let param = {}
        for (const key in demoURLObj.params) {
            param[key] = demoURLObj.params[key]
        }
        for (const key in uriObj.params) {
            param[key] = uriObj.params[key]
        }

        let newURL = demoURLObj.base + demoURLObj.path + '/' + uriObj.fileName + "?" + objectToQueryString(param)

        list[i] = newURL
    }

    return list
}

/**
 * @description 根据m3u8文件下载密钥
 * @param {m3u8} m3u8Content 通过 getm3u8() 获取
 * @param {String} userid 控制台打印 USERID 获取
 * @returns {Buffer} 密钥 key
 */
async function getkey(m3u8Content, userid) {

    const keyUri = m3u8Content.match(/#EXT-X-KEY:.*?\bURI="(.*?)"/)[1]
    let url = keyUri

    try {
        let response = await axios.get(url, { responseType: 'arraybuffer' })
        if (response.data.length == 16)
            return response.data
        else
            throw "decode"

    } catch (error) {
        if (error === "decode") {
            url = keyUri + '&uid=' + userid
            let response = await axios.get(url, { responseType: 'arraybuffer' })
            if (response.data.length == 16)
                return response.data
            else
                return new Error("key length not equal 16")
        }
        else
            return error
    }

}

/**
 * @description 获取 key ^ userid 之后的密钥
 * @param {Buffer} keyBuffer key的Buffer形式，可直接通过 getkey() 获取
 * @param {String} userid 控制台打印 USERID 获取
 * @returns {Buffer} key与userid异或后的密钥
 */
function xorKeys(keyBuffer, userid) {

    // 将密钥转换为数组
    const key1Array = keyBuffer;
    const key2Array = Array.from(userid);

    // 对每个字节进行异或操作
    const result = Buffer.alloc(key1Array.length);
    for (let i = 0; i < key1Array.length; i++) {
        result[i] = key1Array[i] ^ key2Array[i].charCodeAt(0);
    }

    return result;
}

/**
 * @description 下载并保存ts文件
 * @param {URL} fileurl ts文件下载的完整路径，可通过 getTSList() 获取
 * @param {String} savefilepath ts文件下载后保存的路径
 * @returns {Promise}
 */
async function downloadTS(fileurl, savefilepath) {

    console.log(`开始下载：${fileurl}`);
    return new Promise((resolve, reject) => {
        axios({
            method: 'get',
            url: fileurl,
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

/**
 * @description 解密ts文件
 * @param {Buffer} secret_key 解密密钥
 * @param {Buffer} IV 偏移量
 * @param {String} rawfilepath 未解密的 ts 文件路径
 * @param {String} savefilepath 解密后 ts 文件保存的路径
 */
function decode(secret_key, IV, rawfilepath, savefilepath) {

    // 读取密文的TS分片
    const encryptedFilePath = rawfilepath;
    let encryptedData = fs.readFileSync(encryptedFilePath);

    // 创建解密器
    const decipher = crypto.createDecipheriv('aes-128-cbc', secret_key, IV);

    console.log(encryptedData.length % 16)
    // 解密数据
    let decryptedData;
    if (IV.toString('hex') === "00000000000000000000000000000000")
        decryptedData = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    else
        decryptedData = decipher.update(encryptedData);


    // 写入解密后的数据
    const decryptedFilePath = savefilepath;
    fs.writeFileSync(decryptedFilePath, decryptedData);

    console.log('解密完成，输出文件:', decryptedFilePath);

}

async function main() {

    let fileDir = "testDir"
    let userid = `u_***`
    let m3u8Url = "https://pri-cdn-tx.xiaoeknow.com/.../***.m3u8?sign=***&t=***"
    let tsUrldemo = "https://btt-vod.xiaoeknow.com/.../***.ts?start=*&end=***&type=***&sign=***&t=***&us=***"

    // init
    let downloadFilePath = path.join(__dirname, fileDir, 'download')
    let decodeFilePath = path.join(__dirname, fileDir, 'decode')
    ensureDirectoryExists(downloadFilePath)
    ensureDirectoryExists(decodeFilePath)
    if (fs.existsSync(path.join(decodeFilePath, "filelist.txt"))) fs.rmSync(path.join(decodeFilePath, "filelist.txt"))


    // 获取m3u8文件
    let m3u8 = await getm3u8(m3u8Url, fileDir)

    // 获取密钥
    let key = await getkey(m3u8, userid)

    // 获取偏移量
    let IV = getIV(m3u8)

    // 获取所有ts文件url
    const tsUrls = getTSList(m3u8, tsUrldemo)

    // 获取解密的密钥
    let decryptedKey = xorKeys(key, userid);
    console.log('解密后的密钥:', decryptedKey);

    for (let i = 0; i < tsUrls.length; i++) {
        const url = tsUrls[i];
        const filename = `${i}_${url.match(/\/([^\/]+\.ts)(\?|$)/)[1]}`;
        await downloadTS(url, path.join(downloadFilePath, filename))

        let dname = `${i}.ts`
        try {
            await decode(decryptedKey, IV, path.join(downloadFilePath, filename), path.join(decodeFilePath, dname))
        } catch (error) {
            if (error.code == "ERR_OSSL_EVP_BAD_DECRYPT") {
                decryptedKey = key
                await decode(decryptedKey, IV, path.join(downloadFilePath, filename), path.join(decodeFilePath, dname))
            }
            else if (error.code == "ERR_OSSL_EVP_WRONG_FINAL_BLOCK_LENGTH") {
                console.log(error);
                break;
                // let u8 = Buffer.from(decryptedKey, 'utf8');
                // IV = Buffer.alloc(16, 0)
                // await decode(u8, IV, path.join(downloadFilePath, filename), path.join(decodeFilePath, filename))
            }
            else {
                console.log(error);
                break;
            }
        }

        let str = `file '${dname}'\n`
        fs.appendFileSync(path.join(decodeFilePath, "filelist.txt"), str, "utf-8")
    }

    console.log('finish')
}

main()