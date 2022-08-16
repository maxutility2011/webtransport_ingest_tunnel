// Adds an entry to the event log on the page, optionally applying a specified
// CSS class.

let currentTransport, streamNumber, currentTransportDatagramWriter;
var startButton, stopButton, recorder, liveStream, recorderTimer = null;
var disableEventLog = 1;

window.onload = function () {
  startButton = document.getElementById('start');
  stopButton = document.getElementById('stop');

  // get video & audio stream from user
  navigator.mediaDevices.getUserMedia({
    audio: false,
    video: true
  })
  .then(function (stream) {
    liveStream = stream;

    var liveVideo = document.getElementById('preview');
    liveVideo.srcObject = stream;
    liveVideo.play();

    startButton.disabled = false;
    startButton.addEventListener('click', startStreaming);
    stopButton.addEventListener('click', stopStreaming);

  });
};

recordingInterval = 4000;
function startRecorderTimer()
{
  if (!recorderTimer)
  {
  	recorderTimer = setTimeout(getRecording, recordingInterval); // Recordings have to be at least 4 seconds long, otherwise they won't be playable.
  }
  else
  {
	  clearTimeout(recorderTimer);
	  recorderTimer = setTimeout(getRecording, recordingInterval);
  }
}

function getRecording()
{
  recorder.requestData();
  recorderTimer = setTimeout(getRecording, recordingInterval);
}

function onRecordingReady(e) {
  var video = document.getElementById('recording');
  // e.data contains a blob representing the recording

  let chunks = []
  chunks.push(e.data);
  let blob = new Blob(chunks, { 'type' : 'video/webm' });
  //console.log("onRecordingReady: blob size: " + blob.size);

  let currentTime = new Date().getTime();
  sendRecording(blob, currentTime);
  //uploadRecording(blob);

  //saveRecording(blob, currentTime); // Debugging
}

async function uploadRecording(blob) {
  let data = await blob.arrayBuffer();
  console.log("recording size: " + blob.size);

  upload_url = "http://localhost:3000/uploadRecording/";
  var upload_req = new XMLHttpRequest();
  upload_req.open("POST", upload_url, true);

  upload_req.onload = function (e) {
    if (upload_req.readyState === upload_req.DONE) {
      if (upload_req.status === 200) {
        mp4FileUrl = this.response;
        console.log("uploadedFileUrl: " + mp4FileUrl);

        let rec_url = "http://localhost:8000/webtransport_ingest_tunnel/" + mp4FileUrl;
        downloadAndPlayMp4Recording(rec_url, "http_live");
      }
      else {
        console.log("Segment download failed: " + upload_req.status);
      }
    }
  }

  upload_req.send(data);
}

async function saveRecording(data, currentTime)
{
  let newLink = document.createElement("a");
  let recordingFileName = "recording_" + currentTime + ".webm";
  newLink.download = recordingFileName;

  if (window.webkitURL != null) {
    newLink.href = window.webkitURL.createObjectURL(data);
  }
  else {
    newLink.href = window.URL.createObjectURL(data);
    newLink.style.display = "none";
    document.body.appendChild(newLink);
  }

  newLink.click();
}

async function sendRecording(blob, currentTime) {
  let data = await blob.arrayBuffer();
  sendDatagram(data, currentTime);
}

function downloadAndPlayMp4Recording(rec_url, video_element_id)
{
  let rec_req = new XMLHttpRequest();
  rec_req.responseType = 'blob';
  rec_req.open("GET", rec_url, true); // false for synchronous request

  rec_req.onload = function (e) {
    if (rec_req.readyState === rec_req.DONE) {
      if (rec_req.status === 200) {
        let recData = this.response;
        //console.log("Segment downloaded: size = " + segData.byteLength);
        var video = document.getElementById(video_element_id);
        video.src = URL.createObjectURL(recData);
        video.play();
      }
      else {
        console.log("Segment download failed: " + rec_req.status);
      }
    }
  }

  rec_req.send();
}

function startStreaming() {
  var options = { mimeType: "video/webm; codecs=h264" };
  recorder = new MediaRecorder(liveStream, options);

  recorder.addEventListener('dataavailable', onRecordingReady);

  startButton.disabled = true;
  stopButton.disabled = false;

  recorder.start();
  startRecorderTimer();
}

function stopStreaming() {
  startButton.disabled = false;
  stopButton.disabled = true;

  // Stopping the recorder will eventually trigger the 'dataavailable' event and we can complete the recording process
  recorder.stop();
}

// "Connect" button handler.
async function connect() {
  const url = document.getElementById('url').value;
  try {
    var transport = new WebTransport(url);
    addToEventLog('Initiating connection...');
  } catch (e) {
    addToEventLog('Failed to create connection object. ' + e, 'error');
    return;
  }

  try {
    await transport.ready;
    addToEventLog('Connection ready.');
  } catch (e) {
    addToEventLog('Connection failed. ' + e, 'error');
    return;
  }

  transport.closed
      .then(() => {
        addToEventLog('Connection closed normally.');
      })
      .catch(() => {
        addToEventLog('Connection closed abruptly.', 'error');
      });

  currentTransport = transport;
  streamNumber = 1;
  try {
    currentTransportDatagramWriter = transport.datagrams.writable.getWriter();
    addToEventLog('Datagram writer ready.');
  } catch (e) {
    addToEventLog('Sending datagrams not supported: ' + e, 'error');
    return;
  }
  readDatagrams(transport);
  acceptUnidirectionalStreams(transport);
  document.forms.sending.elements.send.disabled = false;
  document.getElementById('connect').disabled = true;
}

const maxPacketSize = 1000; // 1222 was used previously
const packetHeaderSize = 29;
const maxPacketPayloadSize = maxPacketSize - packetHeaderSize;

const zeroPad = (num, places) => String(num).padStart(places, '0')

var _appendBuffer = function(buffer1, buffer2) {
  var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(buffer1, 0);
  tmp.set(buffer2, buffer1.byteLength);
  return tmp.buffer;
};

async function sendDatagram(data, currT) {
  try {
    let d = new Uint8Array(data);
    let bytesSentTotal=0;

    let mediaDataSize = d.byteLength;
    let message_payload_size_string = zeroPad(mediaDataSize, 8);
    
    console.log("mediaDataSize: " + mediaDataSize);

    while (bytesSentTotal < d.byteLength)
    {
      // Send packet header
      // --------------------------------------------------------------------------------------------------
      // Format: |  13 bytes  |        8 bytes       |               8 bytes                |   971 bytes |  
      //         | message_id | message_payload_size | packet_last_byte_position_in_message |   payload   |
      // --------------------------------------------------------------------------------------------------
      let currentTime = currT; // current time (millisecs) = message id
      let encoder = new TextEncoder('utf-8');
      let message_id_string = currentTime.toString();
      //let message_id = encoder.encode(message_id_string);
      //console.log("message_id_string: " + message_id_string);

      let bytesToSend = (d.byteLength - bytesSentTotal <= maxPacketPayloadSize)? d.byteLength - bytesSentTotal : maxPacketPayloadSize;
      //console.log("bytesToSend: " + bytesToSend);
      
      let lastByteThisSend = bytesSentTotal + bytesToSend;
      let packet_last_byte_position_in_message_string = zeroPad(lastByteThisSend, 8);
      //let packet_last_byte_position_in_message_string = lastByteThisSend.toString(16);
      //let packet_last_byte_position_in_message = encoder.encode(packet_last_byte_position_in_message_string);
      //console.log("lastByteThisSend: " + lastByteThisSend);

      let packet_header_string = message_id_string + message_payload_size_string + packet_last_byte_position_in_message_string;
      //console.log("packet_header_string: " + packet_header_string);
      let packet_header = encoder.encode(packet_header_string);
      //await currentTransportDatagramWriter.write(packet_header);
      let outBuffer = _appendBuffer(packet_header, d.subarray(bytesSentTotal, bytesSentTotal + bytesToSend));
      await currentTransportDatagramWriter.write(outBuffer);
  
      bytesSentTotal += bytesToSend;
      console.log('Sent ' + bytesToSend + " bytes");
    }
  } catch (e) {
    console.log('Error while sending datagram: ' + e, 'error');
  }
}

// "Send data" button handler.
async function sendData() {
  let form = document.forms.sending.elements;
  let encoder = new TextEncoder('utf-8');
  let rawData = sending.data.value;
  let data = encoder.encode(rawData);
  let transport = currentTransport;
  try {
    switch (form.sendtype.value) {
      case 'datagram':
        await currentTransportDatagramWriter.write(data);
        addToEventLog('Sent datagram: ' + rawData);
        break;
      case 'unidi': {
        let stream = await transport.createUnidirectionalStream();
        let writer = stream.getWriter();
        await writer.write(data);
        await writer.close();
        addToEventLog('Sent a unidirectional stream with data: ' + rawData);
        break;
      }
      case 'bidi': {
        let stream = await transport.createBidirectionalStream();
        let number = streamNumber++;
        readFromIncomingStream(stream, number);

        let writer = stream.writable.getWriter();
        await writer.write(data);
        await writer.close();
        addToEventLog(
            'Opened bidirectional stream #' + number +
            ' with data: ' + rawData);
        break;
      }
    }
  } catch (e) {
    addToEventLog('Error while sending data: ' + e, 'error');
  }
}

// Reads datagrams from |transport| into the event log until EOF is reached.
async function readDatagrams(transport) {
  try {
    var reader = transport.datagrams.readable.getReader();
    addToEventLog('Datagram reader ready.');
  } catch (e) {
    addToEventLog('Receiving datagrams not supported: ' + e, 'error');
    return;
  }
  let decoder = new TextDecoder('utf-8');
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        addToEventLog('Done reading datagrams!');
        return;
      }
      let data = decoder.decode(value);
      addToEventLog('Datagram received: ' + data);

      let send_ack_key = "SEND_ACK "
      let send_ack_pos = data.search(send_ack_key);
      if (send_ack_pos >= 0)
      {
        data.substring(send_ack_pos + send_ack_key.length, data.length);
        let rec_url = "http://localhost:8000/webtransport_ingest_tunnel/" + data.substring(send_ack_pos + send_ack_key.length, data.length);
        
        downloadAndPlayMp4Recording(rec_url, "webtransport_live");
      }
      else {
        console.log("SEND_ACK not found in response");
      }
    }
  } catch (e) {
    addToEventLog('Error while reading datagrams: ' + e, 'error');
  }
}

async function acceptUnidirectionalStreams(transport) {
  let reader = transport.incomingUnidirectionalStreams.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        addToEventLog('Done accepting unidirectional streams!');
        return;
      }
      let stream = value;
      let number = streamNumber++;
      addToEventLog('New incoming unidirectional stream #' + number);
      readFromIncomingStream(stream, number);
    }
  } catch (e) {
    addToEventLog('Error while accepting streams: ' + e, 'error');
  }
}

async function readFromIncomingStream(stream, number) {
  let decoder = new TextDecoderStream('utf-8');
  let reader = stream.pipeThrough(decoder).getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        addToEventLog('Stream #' + number + ' closed');
        return;
      }
      let data = value;
      addToEventLog('Received data on stream #' + number + ': ' + data);
    }
  } catch (e) {
    addToEventLog(
        'Error while reading from stream #' + number + ': ' + e, 'error');
    addToEventLog('    ' + e.message);
  }
}

function addToEventLog(text, severity = 'info') {
  if (disableEventLog == 1) {
    return;
  }

  let log = document.getElementById('event-log');
  let mostRecentEntry = log.lastElementChild;
  let entry = document.createElement('li');
  entry.innerText = text;
  entry.className = 'log-' + severity;
  log.appendChild(entry);

  // If the most recent entry in the log was visible, scroll the log to the
  // newly added element.
  if (mostRecentEntry != null &&
      mostRecentEntry.getBoundingClientRect().top <
          log.getBoundingClientRect().bottom) {
    entry.scrollIntoView();
  }
}
