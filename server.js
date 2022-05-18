const http = require('http')
const fs = require('fs');

const port = process.env.PORT || 3000

const server = http.createServer((req, res) => {
  res.statusCode = 200
  //res.setHeader('Content-Type', 'text/html')
  //res.end('<h1>Hello, World!</h1>')

  let http_post = "POST";
  switch(req.url) {
    case '/uploadRecording/':
        if (req.method == http_post) {
            var recordedSegment = "";
            req.on("data", function (chunk) {
                recordedSegment += chunk;
            });
    
            req.on("end", function() {
                console.log("recordedSegment length: " + recordedSegment.length);

                let currentTime = new Date().getTime();
                let uploadedFileName = "upload_" + currentTime + ".webm";

                // Write the uploaded webm recording to file.
                fs.writeFile(uploadedFileName, recordedSegment, function (err)
                {
                    if (err) {
                        return console.log(err);
                    }
                });

                // Respond to client with the webm file name.
                const responseBody = Buffer.from(uploadedFileName, 'utf8');

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