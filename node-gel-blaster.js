"use strict";

var i2cBus = require("i2c-bus");
var pca9685 = require("pca9685");

const WebSocket = require('ws');

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const { spawn } = require('child_process');

const httpPort = 8080;
const httpVideoStreamKey = 'supersecret';

var targetWebsocket = null;
const targetAddress = '10.88.0.130';

var FfmpegVideoProcess = null;
var videoRunning = false;

var FfmpegAudioProcess = null;
var audioRunning = false;

// PCA9685 options
var options = {
	i2c: i2cBus.openSync(1),
	//address: 0x40, // generic PCA9685
	address: 0x60, // Adafruit Motor Driver
	frequency: 50
	//debug: true
};

var ServoMax = 2400;
var ServoMin = 800;
var ServoRange = ServoMax - ServoMin;

var pwmPanChannel = 15;
var pwmTiltChannel = 14;

var steeringValue = 500; // midpoint - straight foward

var throttleThreshold = 60.0
var throttleMidpoint = 500.0

var motorPercentMin = 0.2; // 20% pwm duty cycle for minimum motor movement
//var motorPwmMax = 4095
//var motorPwmRange = 1000.0
//var motorPwmOffset = motorPwmMax - motorPwmRange

var pwmShootChannel = 1;

var pwm = new pca9685.Pca9685Driver(options, function startLoop(err) {
	if (err) {
		console.error("Error initializing PCA9685");
		process.exit(-1);
		return;
	}

	console.log("PCA9685 Initialized");
	pwm.setPulseLength(pwmPanChannel, 1500);
	pwm.setPulseLength(pwmTiltChannel, 1500);
});

function motorSetPercent(motorNo, direction, throttlePercent){
	let pinPwm, pinin1, pinin2;

	switch (motorNo) {
		default:
			console.log("invalid motor! "+ motorNo);
			return;
		case 1:
			pinPwm = 2;
			pinin1 = 4;
			pinin2 = 3;
			break;
		case 2:
			pinPwm = 7;
			pinin1 = 6;
			pinin2 = 5;
			break;
	}

	var onValue = 4096;
	console.log("throttlePercent = "+(throttlePercent*100));
	if (throttlePercent == 0) {

		pwm.channelOff(pinin1);
		pwm.channelOff(pinin2);
		pwm.channelOff(pinPwm);
	}else{

		if (direction >= 1) {
			pwm.channelOn(pinin2);
			pwm.channelOff(pinin1);
		} else {
			pwm.channelOff(pinin2);
			pwm.channelOn(pinin1);
		}

		throttlePercent = motorPercentMin + throttlePercent;
		console.log("motor "+motorNo+" throttle % = " + throttlePercent);
		pwm.setDutyCycle(pinPwm, throttlePercent);
	}
}
const webSocketServer = new WebSocket.Server({ noServer: true });

webSocketServer.on('connection', function connection(ws, req) {

	const ip = req.connection.remoteAddress;
	console.log('connection from ' + ip);

	 ws.on('message', function(message){
	 	handleIncomingControlMessage(ws, message);
	});

	ws.on('close', function clear() {
		console.log('connection closed for ' + ip);
	});

	ws.send('{"connected":true}');
});

function handleIncomingControlMessage(ws, message) {
	console.log('received: %s', message);
	
	let messageJson;
	try{
		messageJson = JSON.parse(message);
	}catch(err) {
		console.log('invalid json message');
		console.log(err);
		return;
	}
	if(!messageJson.action){
		console.log('invalid json message, missing action');
		return;
	}
	switch(messageJson.action){
		case "startTargetTimer":
			targetWebsocketStartTimer();
			break;
		case "stopVideo":
			stopVideoProcess();
			break;
		case "startVideo":
			startVideoProcess();
			break;
		case "readVideoRunning":
			ws.send('{"msgType":"videoRunning","running":'+(videoRunning?1:0)+'}');

			break;
		case "setShoot":
			if(!messageJson.hasOwnProperty('value')){
				console.log('invalid json message, missing value');
				return;
			}
			
			if(messageJson.value >= 1){
				console.log("FIRE!");
				pwm.channelOn(pwmShootChannel);
			}else{
				console.log("STOP FIRE!");
				pwm.channelOff(pwmShootChannel);
			}

			break;
		// case "setSteering":
		// 	if(!messageJson.hasOwnProperty('value')){
		// 		console.log('invalid json message, missing value');
		// 		return;
		// 	}
		// 	steeringValue = parseInt(messageJson.value);
		// 	break;
		//case "setThrottle":
		case "move":
			if(!messageJson.hasOwnProperty('y') || !messageJson.hasOwnProperty('x')){
				console.log('invalid json message, missing value');
				return;
			}
			//move X is throttle
			//move Y is steering
			
			var steeringValue = messageJson.y;
			var throttleValue = messageJson.x;

			//if steering hard then spin in place
			if(steeringValue >= 800){
				//hard right
				steeringValue -= 800;
				steeringValue /= 200;
				motorSetPercent(2, 1, steeringValue);
				motorSetPercent(1, 0, steeringValue);
				return;
			}
			if(steeringValue <= 200){
				//hard left
				steeringValue /= 200;
				steeringValue = 1 - steeringValue;//invert

				motorSetPercent(2, 0, steeringValue);
				motorSetPercent(1, 1, steeringValue);
				return;
			}

			if (throttleValue > throttleMidpoint-throttleThreshold && throttleValue < throttleMidpoint+throttleThreshold) {

				console.log("setThrottle stop "+throttleValue);
				motorSetPercent(1, 0, 0);
				motorSetPercent(2, 0, 0);

			} else {

				//calc steering offset

				if (throttleValue >= 500) {
					//forward
					throttleValue = (throttleValue - 500) / 500;

					console.log("setThrottle fwd throttleValue = "+throttleValue );

					motorSetPercent(1, 1, throttleValue);
					motorSetPercent(2, 1, throttleValue);

				} else {
					//reverse
					throttleValue = (500 - throttleValue) / 500;

					console.log("setThrottle rev throttleValue = "+throttleValue );

					motorSetPercent(1, -1, throttleValue);
					motorSetPercent(2, -1, throttleValue);
				}
			}

			break;
		case "setTilt":
			if(!messageJson.hasOwnProperty('value')){
				console.log('invalid json message, missing value');
				return;
			}
			var servoPercent = messageJson.value / 1000;

			var servoValue = ServoRange * servoPercent + ServoMin;

			console.log('tilt pwm = '+servoValue);
			pwm.setPulseLength(pwmTiltChannel, servoValue);
			break;
		case "setPan":
			if(!messageJson.hasOwnProperty('value')){
				console.log('invalid json message, missing value');
				return;
			}
			var servoPercent = messageJson.value / 1000;

			var servoValue = ServoRange * servoPercent + ServoMin;

			console.log('pan pwm = '+servoValue);
			pwm.setPulseLength(pwmPanChannel, servoValue);
			break;
		default:
			console.log("invalid action!");
			return;
	}
};

function targetWebsocketConnect(afterConnectCb){
	var afterConnectCallback = afterConnectCb || function(){};
	if(targetWebsocket !== null){
		return;
	}
	targetWebsocket = new WebSocket('ws://'+targetAddress+'/ws');
	targetWebsocket.on('open', function() {
		console.log('Target Websocket Connection Opened to '+targetAddress);
		afterConnectCallback();
	});
	targetWebsocket.on('close', function(code, reason) {
		console.log('Target Websocket Connection Closed '+code+' '+reason);
		targetWebsocket = null;
	});
	targetWebsocket.on('error', function(error) {
		console.log('Target Websocket Connection Error ',error);
	});

	targetWebsocket.on('message', function(message) {
		console.log('Target Websocket Message:');
		console.log(message);
		targetWebsocketMessageRecieved(message);
	});
}
function targetWebsocketMessageRecieved(message){
	let messageJson;
	try{
		messageJson = JSON.parse(message);
	}catch(err) {
		console.log('invalid json message');
		console.log(err);
		return;
	}
	if(!messageJson.cmd){
		console.log('invalid json message, missing cmd');
		return;
	}
	switch(messageJson.cmd){
		default:
			console.log("invalid cmd!");
			return;
			break;
		case 'targetDown':
	}
}
function targetWebsocketSend(msg){
	if(!targetWebsocket){
		targetWebsocketConnect(function(){
			targetWebsocket.send(msg);
		});
	}else{
		targetWebsocket.send(msg);
	}
}
function targetWebsocketStartTimer(){
	//targetWebsocketSend('{"cmd":"mode","value":"all"}');
	targetWebsocketSend('{"cmd":"targetUp","value":"all"}');
	
	

}

const videoServer = new WebSocket.Server({ noServer: true });
videoServer.on('connection', function(socket, upgradeReq) {
	videoServer.connectionCount++;
	console.log(
		'New Video Viewer Connection: ', 
		(upgradeReq || socket.upgradeReq).socket.remoteAddress,
		(upgradeReq || socket.upgradeReq).headers['user-agent'],
		'('+videoServer.connectionCount+' total)'
	);
	socket.on('close', function(code, message){
		videoServer.connectionCount--;
		console.log(
			'Disconnected WebSocket ('+videoServer.connectionCount+' total)'
		);
	});
});

function broadcastVideoData(data) {
	videoServer.clients.forEach(function each(clientSocket) {
		if (clientSocket.readyState === WebSocket.OPEN) {
			clientSocket.send(data);
		}
	});
};

function stopVideoProcess(){
	if(FfmpegVideoProcess !== null){
		FfmpegVideoProcess.kill();
		FfmpegAudioProcess.kill();
	}
}
function startVideoProcess(){
	if(videoRunning){
		console.log('startVideo() - Video already running - not starting');
		return;
	}
	console.log('startVideo() - launching ffmpeg');


	// $ v4l2-ctl --list-devices
	// bcm2835-codec (platform:bcm2835-codec):
	// 		/dev/video10
	// 		/dev/video11
	// 		/dev/video12
	
	// HD Pro Webcam C920 (usb-3f980000.usb-1.1.3):
	// 		/dev/video0
	// 		/dev/video1
	

	// $ ffmpeg -f v4l2 -list_formats all -i /dev/video0
	// ffmpeg version 3.2.14-1~deb9u1+rpt1 Copyright (c) 2000-2019 the FFmpeg developers
	//   built with gcc 6.3.0 (Raspbian 6.3.0-18+rpi1+deb9u1) 20170516
	//   configuration: --prefix=/usr --extra-version='1~deb9u1+rpt1' --toolchain=hardened --libdir=/usr/lib/arm-linux-gnueabihf --incdir=/usr/include/arm-linux-gnueabihf --enable-gpl --disable-stripping --enable-avresample --enable-avisynth --enable-gnutls --enable-ladspa --enable-libass --enable-libbluray --enable-libbs2b --enable-libcaca --enable-libcdio --enable-libebur128 --enable-libflite --enable-libfontconfig --enable-libfreetype --enable-libfribidi --enable-libgme --enable-libgsm --enable-libmp3lame --enable-libopenjpeg --enable-libopenmpt --enable-libopus --enable-libpulse --enable-librubberband --enable-libshine --enable-libsnappy --enable-libsoxr --enable-libspeex --enable-libssh --enable-libtheora --enable-libtwolame --enable-libvorbis --enable-libvpx --enable-libwavpack --enable-libwebp --enable-libx265 --enable-libxvid --enable-libzmq --enable-libzvbi --enable-omx --enable-omx-rpi --enable-mmal --enable-openal --enable-opengl --enable-sdl2 --enable-libdc1394 --enable-libiec61883 --arch=armhf --enable-chromaprint --enable-frei0r --enable-libopencv --enable-libx264 --enable-shared
	//   libavutil      55. 34.101 / 55. 34.101
	//   libavcodec     57. 64.101 / 57. 64.101
	//   libavformat    57. 56.101 / 57. 56.101
	//   libavdevice    57.  1.100 / 57.  1.100
	//   libavfilter     6. 65.100 /  6. 65.100
	//   libavresample   3.  1.  0 /  3.  1.  0
	//   libswscale      4.  2.100 /  4.  2.100
	//   libswresample   2.  3.100 /  2.  3.100
	//   libpostproc    54.  1.100 / 54.  1.100
	// [video4linux2,v4l2 @ 0x20485c0] Raw       :     yuyv422 :           YUYV 4:2:2 : 640x480 160x90 160x120 176x144 320x180 320x240 352x288 432x240 640x360 800x448 800x600 864x480 960x720 1024x576 1280x720 1600x896 1920x1080 2304x1296 2304x1536
	// [video4linux2,v4l2 @ 0x20485c0] Compressed:        h264 :                H.264 : 640x480 160x90 160x120 176x144 320x180 320x240 352x288 432x240 640x360 800x448 800x600 864x480 960x720 1024x576 1280x720 1600x896 1920x1080
	// [video4linux2,v4l2 @ 0x20485c0] Compressed:       mjpeg :          Motion-JPEG : 640x480 160x90 160x120 176x144 320x180 320x240 352x288 432x240 640x360 800x448 800x600 864x480 960x720 1024x576 1280x720 1600x896 1920x1080

	
	// videoFfmpegProcess = spawn('ffmpeg', [
	// 	//input video
	// 	'-f', 'v4l2', //video4linux2
	// 	//'-threads', '4', 
	// 	//'-framerate','20',
	// 	'-video_size','800x448', // '800x448' good, '1280x720' fails, '960x720' fails
	// 	'-i','/dev/video0',
	// 	//input audio
	// 	'-f','alsa', //alsa audio
	// 	'-i','hw:1', //audio device
	// 	'-ar','44100', //audio sample rate
	// 	'-c','2', //audio channels
	// 	//output
	// 	'-f','mpegts', //output codec format
	// 	'-framerate','15',
	// 	'-codec:v','mpeg1video',
	// 	'-b:v','1800k',
	// 	'-codec:a', 'mp2',
	// 	'-b:a','128k',
	// 	'-bf','0',
	// 	'-muxdelay','0.001',
	// 	'http://127.0.0.1:8080/sendVideo/?streamKey=supersecret'
	// ]);

	FfmpegAudioProcess = spawn('ffmpeg', [
		//input video
		'-vn', //no video
		'-f','alsa', //alsa audio
		'-i','hw:1', //audio device
		'-ar','44100', //audio sample rate
		'-c','2', //audio channels
		//output
		'-f','mpegts', //output codec format
		'-codec:a', 'mp2',
		'-b:a','128k',
		'-bf','0',
		'-muxdelay','0.001',
		'http://127.0.0.1:8080/sendVideo/?streamKey=supersecret'
	]);
	audioRunning = true;
	
	FfmpegAudioProcess.on('exit', (code) => {
		console.log('startVideo() - ffmpeg AUDIO process exited');
		videoRunning = false;
		FfmpegAudioProcess = null;
	});

	FfmpegAudioProcess.stdout.on('data', (data) => {
	  console.log(data.toString());
	});
	
	FfmpegAudioProcess.stderr.on('data', (data) => {
	  console.error(data.toString());
	});



	FfmpegVideoProcess = spawn('python', [
		'cameraoverlay.py'
	]);
	videoRunning = true;
	
	FfmpegVideoProcess.on('exit', (code) => {
		console.log('startVideo() - ffmpeg VIDEO process exited');
		videoRunning = false;
		FfmpegVideoProcess = null;
	});

	FfmpegVideoProcess.stdout.on('data', (data) => {
	  console.log(data.toString());
	});
	
	FfmpegVideoProcess.stderr.on('data', (data) => {
	  console.error(data.toString());
	});
	
}

// maps file extention to MIME types
const mimeType = {
	'.ico': 'image/x-icon',
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.wav': 'audio/wav',
	'.mp3': 'audio/mpeg',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf',
	'.doc': 'application/msword',
	'.eot': 'appliaction/vnd.ms-fontobject',
	'.ttf': 'aplication/font-sfnt'
};

var videoClients = [];

const httpServer = http.createServer(function (req, res) {
	console.log(`${req.method} ${req.url}`);

	// parse URL
	const parsedUrl = url.parse(req.url);
	console.log(`parsedUrl.pathname = ${parsedUrl.pathname}`);

	// if(parsedUrl.pathname == '/viewVideo'){
	// 	const parsedUrl = url.parse(req.url);
	// 	console.log(log.query);
		
	// 	return;
	// }
	if(parsedUrl.pathname.indexOf('/sendVideo') != -1){

		var error = true, errorDescription = 'missing streamKey parameter';

		if(parsedUrl.query !== null ){
			var parsedQuery = querystring.parse(parsedUrl.query);

			if( parsedQuery.streamKey && parsedQuery.streamKey === httpVideoStreamKey){
				error = false;
			}else{
				errorDescription = 'wrong streamKey parameter';
			}
		}
		if(error === true){
			console.log(`Failed Stream Connection: ${req.socket.remoteAddress}:${req.socket.remotePort} ${errorDescription}`);
			res.end();
			return;
		}
	
		res.connection.setTimeout(0);
		console.log(
			'Incoming Video Stream Connected: ' + 
			req.socket.remoteAddress + ':' +
			req.socket.remotePort
		);
		req.on('data', function(data){
			broadcastVideoData(data);
		});
		req.on('end',function(){
			console.log('closed client');
		});

		return;
	}


	// extract URL path
	// Avoid https://en.wikipedia.org/wiki/Directory_traversal_attack
	// e.g curl --path-as-is http://localhost:9000/../fileInDanger.txt
	// by limiting the path to current directory only
	const sanitizePath = path.normalize(parsedUrl.pathname).replace(/^(\.\.[\/\\])+/, '');
	let pathname = path.join(__dirname, 'webroot/', sanitizePath);

	fs.exists(pathname, function (exist) {
		if (!exist) {
			// if the file is not found, return 404
			res.statusCode = 404;
			res.end(`File ${pathname} not found!`);
			return;
		}

		// if is a directory, then look for index.html
		if (fs.statSync(pathname).isDirectory()) {
			pathname += '/index.html';
		}

		// read file from file system
		fs.readFile(pathname, function (err, data) {
			if (err) {
				res.statusCode = 500;
				res.end(`Error getting the file: ${err}.`);
			} else {
				// based on the URL path, extract the file extention. e.g. .js, .doc, ...
				const ext = path.parse(pathname).ext;
				// if the file is found, set Content-type and send data
				res.setHeader('Content-type', mimeType[ext] || 'text/plain');
				res.end(data);
			}
		});
	});


}).listen(httpPort);


httpServer.on('upgrade', function upgrade(request, socket, head) {
	const pathname = url.parse(request.url).pathname;

	switch(pathname){
		case '/wsapi': 
			webSocketServer.handleUpgrade(request, socket, head, function done(ws) {
				webSocketServer.emit('connection', ws, request);
			});
			break;
		case '/viewVideo': 
			videoServer.handleUpgrade(request, socket, head, function done(ws) {
				videoServer.emit('connection', ws, request);
			});
			break;
		default:
			socket.destroy();
	}
});

function shutdownPwm(){

	console.log("center all pwm channels");
	pwm.setPulseLength(pwmPanChannel, 1500);
	pwm.setPulseLength(pwmTiltChannel, 1500);
	
	console.log("stoppnig motors...");
	// motorSetPercent(1, 0, 0);
	// motorSetPercent(2, 0, 0);

	// pwm.channelOff(pwmPanChannel);
	// pwm.channelOff(pwmTiltChannel);

	pwm.dispose();
}

targetWebsocketConnect();

// set-up CTRL-C with graceful shutdown
process.on("SIGINT", function () {
	console.log("\nGracefully shutting down from SIGINT (Ctrl-C)");

	shutdownPwm();
	targetWebsocket.close();

	process.exit(-1);
});
