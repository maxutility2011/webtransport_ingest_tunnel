const http = require('http')
const fs = require('fs');
const { exec } = require("child_process");

const port = process.env.PORT || 3000

function webm_to_mp4(srcPath, dstPath)
{
    console.log("srcPath: " + srcPath + " dstPath: " + dstPath);

    let ffmpegCmd = "ffmpeg -fflags +genpts -i " + srcPath + " -r 24 " + dstPath;
    console.log("ffmpegCmd: " + ffmpegCmd);

    exec(ffmpegCmd, (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
            //return error.message;
        }
        if (stderr) {
            console.log(`stderr: ${stderr}`);
            //return `stderr: ${stderr}`;
        }

        console.log(`stdout: ${stdout}`);
        //return null;
    });
}

const server = http.createServer((req, res) => {
  res.statusCode = 200;

  let http_post = "POST";
  switch(req.url) {
    case '/uploadRecording/':
        if (req.method == http_post) {
            console.log("content-length: " + req.headers['content-length']); 
            //var recordedSegment = [];
            var recordedSegment = Buffer.from([]); // create a buffer

            req.on("data", function (chunk) {
                //recordedSegment += chunk;
                recordedSegment = Buffer.concat([recordedSegment,chunk]);
            });
    
            req.on("end", function() {
                //console.log("recordedSegment length: " + recordedSegment.length);
                console.log("recordedSegment length: " + recordedSegment.length);

                let currentTime = new Date().getTime();
                let uploadedFileName = "upload_" + currentTime;
                let webmFilePath = uploadedFileName + ".webm";
                let mp4FilePath = uploadedFileName + ".mp4";

                // Write the uploaded webm recording to file.
                fs.writeFile(webmFilePath, recordedSegment, function (err)
                {
                    if (err) {
                        return console.log(err);
                    }
                });

                webm_to_mp4(webmFilePath, mp4FilePath);

                // Respond to client with the webm file name.
                const responseBody = Buffer.from(mp4FilePath, 'utf8');

                //res.writeHead(200, { "Content-Type": "text/plain" });
                res.write(responseBody, 'utf8', () => {
                    console.log("Writing Response Data...");
                 });

                res.end();
            });
        }
  }
})

server.listen(port, () => {
  console.log(`Server running at port ${port}`)
})