"use strict";

var i2cBus = require("i2c-bus");
var pca9685 = require("pca9685");

const WebSocket = require('ws');

const http = require('http');
const net = require('net');
const url = require('url');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const { spawn } = require('child_process');

const httpPort = 8080;
const httpVideoStreamKey = 'supersecret';

var videoServerConnectionCount = 0;
var audioServerConnectionCount = 0;

const videoHudSocket = '/tmp/hudSocket';
var videoHudSocketCon = null;

var targetWebsocket = null;
const targetAddress = '10.88.0.130';

var shootingTimerDurationSecond = 30.1;
var shootingScore = 0;
var shootingRoundActive = false;
var hideScoreDelay = null;

var FfmpegVideoProcess = null;
var videoRunning = false;

var FfmpegAudioProcess = null;
var audioRunning = false;


var internetVideoStarted = false;
var internetVideoConnection = null;
var internetAudioConnection = null;
var internetVideoReConnectDelayTime = 3000;
var internetVideoUrl = 'vcn2.roboprojects.com:8055';
var internetVideoUrlProtocol = 'http://'
var internetVideoUrlPathVideo = '/sendVideo/';
var internetVideoUrlPathAudio = '/sendAudio/';
var internetVideoUrlKeyString = '?streamKey=';
var internetVideoUrlKey = 'fartbuttpoo';

var internetControlStarted = false;
var internetControlWebSocket = null;
var internetControlUrl = internetVideoUrl;
var internetControlUrlPath = '/control';

var messageLocal = 1;
var messageInternet = 2;

// PCA9685 options
var options = {
	i2c: i2cBus.openSync(1),
	//address: 0x40, // generic PCA9685
	address: 0x60, // Adafruit Motor Driver
	frequency: 50
	//debug: true
};

//full range:
//var ServoMax = 2400;
//var ServoMin = 800;
var ServoMax = 2400;
var ServoMin = 800;
var ServoRange = ServoMax - ServoMin;

var ServoTiltMax = 2156;
var ServoTiltMin = 1100;
var ServoTiltRange = ServoTiltMax - ServoTiltMin;

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
	 	handleIncomingControlMessage(ws, message, messageLocal);
	});

	ws.on('close', function clear() {
		console.log('connection closed for ' + ip);
	});

	ws.send('{"connected":true}');
});
function internetVideoStart(url, key){

	if(internetVideoUrl !== url || internetVideoUrlKey !== key){
		internetVideoStop();
	}
	internetVideoUrl = url;
	internetVideoUrlKey = key;

	startVideoProcess();

	internetVideoStarted = true;
	internetVideoConnect();
	internetAudioConnect();
}
function internetVideoStop(){
	internetVideoStarted = false;

	if(internetVideoConnection){
		internetVideoConnection.end();
	}
	internetVideoConnection = null;

	if(internetAudioConnection){
		internetAudioConnection.end();
	}
	internetAudioConnection = null;

	internetVideoStarted = false;
}
function internetVideoReConnectDelay(){
	setTimeout(function(){
		internetVideoConnect();
	}, internetVideoReConnectDelayTime);
}
function internetVideoConnect(){
	if(internetVideoConnection !== null){
		console.log("internetVideoConnect failed, already connected");
		return;
	}
	let url = internetVideoUrlProtocol + internetVideoUrl + internetVideoUrlPathVideo + internetVideoUrlKeyString + internetVideoUrlKey;
	let options = {
		family:4,
		timeout: 0,
		headers:{
			'Transfer-Encoding':'chunked'
		}
	};
	internetVideoConnection = http.request(url, options);
	
	internetVideoConnection.on('socket', function(){
		console.log("internetVideoConnect socket");
	});
	internetVideoConnection.on('connect', function(){
		console.log("internetVideoConnect connected");
	});
	internetVideoConnection.on('aborted', function(){
		console.log("internetVideoConnect aborted");
		internetVideoConnection = null;
	});
	internetVideoConnection.on('close', function(){
		console.log("internetVideoConnect close");
		internetVideoConnection = null;
		internetVideoReConnectDelay();
	});
	internetVideoConnection.on('error', function(){
		console.log("internetVideoConnect error");
		internetVideoConnection = null;
	});
	// internetVideoConnection.on('timeout', function(){
	// 	console.log("internetVideoConnect timeout");
	// 	internetVideoConnection = null;
	// 	internetVideoReConnectDelay();
	// });
	internetVideoConnection.on('response', function(){
		console.log("internetVideoConnect response");
	});
	internetVideoConnection.flushHeaders();
	console.log("internetVideoConnect connecting");
}
function internetVideoSendVideoData(data){

	if(internetVideoConnection === null ){
		return;
	}
	internetVideoConnection.write(data);
}

function internetAudioReConnectDelay(){
	setTimeout(function(){
		internetAudioConnect();
	}, internetVideoReConnectDelayTime);
}
function internetAudioConnect(){
	if(internetAudioConnection !== null){
		console.log("internetAudioConnect failed, already connected");
		return;
	}
	let url = internetVideoUrlProtocol + internetVideoUrl + internetVideoUrlPathAudio + internetVideoUrlKeyString + internetVideoUrlKey;
	let options = {
		family:4,
		timeout: 0,
		headers:{
			'Transfer-Encoding':'chunked'
		}
	};
	internetAudioConnection = http.request(url, options);
	
	internetAudioConnection.on('socket', function(){
		console.log("internetAudioConnect socket");
	});
	internetAudioConnection.on('connect', function(){
		console.log("internetAudioConnect connected");
	});
	internetAudioConnection.on('aborted', function(){
		console.log("internetAudioConnect aborted");
		internetAudioConnection = null;
	});
	internetAudioConnection.on('close', function(){
		console.log("internetAudioConnect close");
		internetAudioConnection = null;
		internetAudioReConnectDelay();
	});
	internetAudioConnection.on('error', function(){
		console.log("internetAudioConnect error");
		internetAudioConnection = null;
	});
	// internetAudioConnection.on('timeout', function(){
	// 	console.log("internetAudioConnect timeout");
	// 	internetAudioConnection = null;
	// 	internetAudioReConnectDelay();
	// });
	internetAudioConnection.on('response', function(){
		console.log("internetAudioConnect response");
	});
	internetAudioConnection.flushHeaders();
	console.log("internetAudioConnect connecting");
}
function internetVideoSendAudioData(data){

	if(internetAudioConnection === null ){
		return;
	}
	internetAudioConnection.write(data);
}




function internetControlStart(){
	internetControlStarted = true;
	internetControlWebSocketConnect();
}
function internetControlStop(){
	internetControlStarted = false;
	internetControlWebSocketClose();
}
function internetControlWebSocketClose(){
	if(internetControlWebSocket !== null ){
		internetControlWebSocket.close();
	}
}
function internetControlWebSocketConnect(){
	if(internetControlStarted === false){
		console.log('internet control websocket, not connecting, internetControlDisabled');
		return;
	}
	if(internetControlWebSocket !== null){
		console.log('internet control websocket, already active');
		return;
	}
	console.log('internet control websocket, connecting to '+internetControlUrl);
	internetControlWebSocket = new WebSocket('ws://'+internetControlUrl+ internetControlUrlPath);
	internetControlWebSocket.on('open', function() {
		console.log('internet control websocket, connection Opened to '+internetControlUrl);
	});
	internetControlWebSocket.on('close', function(code, reason) {
		console.log('internet control websocket, connection Closed '+code+' '+reason);
		internetControlWebSocket = null;
		setTimeout(internetControlWebSocketConnect, 2000);
	});
	internetControlWebSocket.on('error', function(error) {
		console.log('internet control websocket, connection Error ',error.code);
	});

	internetControlWebSocket.on('message', function(message){
		console.log('internet control websocket, msg rcvd: "%s"', message);
		handleIncomingControlMessage(false, message, messageInternet);
	});
}
function InternetControlWebsocketSend(msg){
	if(!internetControlWebSocket || internetControlWebSocket.readyState !== WebSocket.OPEN){
		console.log("internet control websocket, send failed, not connected");
		console.log(msg);
		return;
	}

	internetControlWebSocket.send(msg);
}




function handleIncomingControlMessage(wsp, message, source) {
	var ws = wsp || false;
	console.log('control, revc: "%s"', message);
	
	let messageJson;
	try{
		messageJson = JSON.parse(message);
	}catch(err) {
		console.log('control,invalid json message');
		return;
	}
	if(!messageJson.action){
		console.log('control, invalid json message, missing action');
		return;
	}
	switch(messageJson.action){
		case "internetVideo":
			if(!messageJson.hasOwnProperty("enabled")){
				console.log('control, internetVideo action, missing enabled');
				return;
			}
			if(!messageJson.hasOwnProperty("server")){
				console.log('control, internetVideo action, missing server');
				return;
			}
			if(!messageJson.hasOwnProperty("key")){
				console.log('control, internetVideo action, missing key');
				return;
			}
			if(messageJson.enabled){
				console.log('control, internetVideo action, enabled');
				internetVideoStart(messageJson.server, messageJson.key);
			}else{
				console.log('control, internetVideo action, disabled');
				internetVideoStop();
			}
			break;
		case "internetControl":
			if(!messageJson.hasOwnProperty("enabled")){
				console.log('control, internetControl action, missing enabled');
				return;
			}
			if(messageJson.enabled){
				console.log('control, internetControl action, enabled');
				internetControlStart();
			}else{
				console.log('control, internetControl action, disabled');
				internetControlStop();
			}
			break;
		case "startTargets":
			targetWebsocketSetMode();
			break;
		case "startTargetTimer":
			overlayStartTimer();
			shootingScore = 0;
			shootingRoundActive = true;
			break;
		case "stopTargetTimer":
			overlayStopTimer();
			shootingRoundActive = false;
			break;
		case "stopVideo":
			stopVideoProcess();
			break;
		case "startVideo":
			startVideoProcess();
			break;
		case "readVideoRunning":
			if(ws !== false){
				ws.send('{"cmd":"videoRunning","running":'+(videoRunning === true?1:0)+'}');
			}

			break;
		case "setShoot":
			if(source === messageInternet){
				console.log('disregarding shoot from internet');
				return;
			}
			if(!messageJson.hasOwnProperty('value')){
				console.log('control, setShoot, missing value');
				return;
			}
			
			if(messageJson.value >= 1){
				console.log("control, FIRE!");
				pwm.channelOn(pwmShootChannel);
			}else{
				console.log("control, STOP FIRE!");
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
				console.log('control, move, missing value');
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

				console.log("control, setThrottle stop "+throttleValue);
				motorSetPercent(1, 0, 0);
				motorSetPercent(2, 0, 0);

			} else {

				//calc steering offset

				if (throttleValue >= 500) {
					//forward
					throttleValue = (throttleValue - 500) / 500;

					console.log("control, setThrottle fwd throttleValue = "+throttleValue );

					motorSetPercent(1, 1, throttleValue);
					motorSetPercent(2, 1, throttleValue);

				} else {
					//reverse
					throttleValue = (500 - throttleValue) / 500;

					console.log("control, setThrottle rev throttleValue = "+throttleValue );

					motorSetPercent(1, -1, throttleValue);
					motorSetPercent(2, -1, throttleValue);
				}
			}

			break;
		case "setTilt":
			if(!messageJson.hasOwnProperty('value')){
				console.log('control, setTilt, missing value');
				return;
			}
			var servoPercent = messageJson.value / 1000;

			var servoValue = ServoTiltRange * servoPercent + ServoTiltMin;

			console.log('control, setTilt, pwm = '+servoValue);
			pwm.setPulseLength(pwmTiltChannel, servoValue);
			break;
		case "setPan":
			if(!messageJson.hasOwnProperty('value')){
				console.log('control, setPan, missing value');
				return;
			}
			var servoPercent = messageJson.value / 1000;

			var servoValue = ServoRange * servoPercent + ServoMin;

			console.log('control, setPan, pwm = '+servoValue);
			pwm.setPulseLength(pwmPanChannel, servoValue);
			break;
		default:
			console.log("control, unknown action!");
			return;
	}
};
function targetWebsocketClose(){
	if(targetWebsocket !== null ){
		targetWebsocket.close();
	}
}
function targetWebsocketConnect(){
	if(targetWebsocket !== null){
		return;
	}
	console.log("target websocket, connecting to "+targetAddress);
	var newWebsocket = new WebSocket('ws://'+targetAddress+'/ws');
	newWebsocket.on('open', function() {
		targetWebsocket = newWebsocket;
		console.log('target websocket, connection Opened to '+targetAddress);
	});
	newWebsocket.on('close', function(code, reason) {
		console.log('target websocket, connection Closed '+code+' '+reason);
		targetWebsocket = null;
		setTimeout(targetWebsocketConnect, 2000);
	});
	newWebsocket.on('error', function(error) {
		console.log('target websocket, connection Error ',error.code);
	});

	newWebsocket.on('message', targetWebsocketMessageRecieved);
}
function targetWebsocketMessageRecieved(message){
	console.log('target websocket, msg rcvd: "%s"', message);

	let messageJson;
	try{
		messageJson = JSON.parse(message);
	}catch(err) {
		console.log('target websocket, msg rcvd, invalid json');
		return;
	}
	if(!messageJson.cmd){
		console.log('target websocket, msg rcvd, error no cmd');
		return;
	}
	switch(messageJson.cmd){
		default:
			console.log("target websocket, msg rcvd, error unknown cmd");
			return;
			break;
		case 'targetDown':
			console.log("target websocket, msg rcvd, Target Knocked!");
			if(shootingRoundActive){
				console.log("score!");
				shootingScore ++;
				overlayUpdateScore();
			}else{
				console.log("target websocket, msg rcvd, No Score - No shooting round active!");
			}

	}
}
function targetWebsocketSend(msg){
	if(!targetWebsocket || targetWebsocket.readyState !== WebSocket.OPEN){
		console.log("target websocket send failed, not connected");
		console.log(msg);
		return;
	}

	targetWebsocket.send(msg);
}
function targetWebsocketSetMode(){
	targetWebsocketSend('{"cmd":"mode","value":"all"}');
	targetWebsocketSend('{"cmd":"targetUp","value":"all"}');
}
function targetWebsocketStartTimer(){
	shootingScore = 0;
	shootingRoundActive = 1;
}

const videoServer = new WebSocket.Server({ noServer: true });
videoServer.on('connection', function(socket, upgradeReq) {
	videoServerConnectionCount++;
	console.log(
		'New Video Viewer Connection: ', 
		(upgradeReq || socket.upgradeReq).socket.remoteAddress,
		(upgradeReq || socket.upgradeReq).headers['user-agent'],
		'('+videoServerConnectionCount+' total)'
	);
	socket.on('close', function(code, message){
		videoServerConnectionCount--;
		console.log(
			'Disconnected Video WebSocket ('+videoServerConnectionCount+' total)'
		);
	});
});
function broadcastVideoData(data) {
	videoServer.clients.forEach(function each(clientSocket) {
		if (clientSocket.readyState === WebSocket.OPEN) {
			clientSocket.send(data);
		}
	});
}

const audioServer = new WebSocket.Server({ noServer: true });
audioServer.on('connection', function(socket, upgradeReq) {
	audioServerConnectionCount++;
	console.log(
		'New Audio Viewer Connection: ', 
		(upgradeReq || socket.upgradeReq).socket.remoteAddress,
		(upgradeReq || socket.upgradeReq).headers['user-agent'],
		'('+audioServerConnectionCount+' total)'
	);
	socket.on('close', function(code, message){
		audioServerConnectionCount--;
		console.log(
			'Disconnected Audio WebSocket ('+audioServerConnectionCount+' total)'
		);
	});
});
function broadcastAudioData(data) {
	audioServer.clients.forEach(function each(clientSocket) {
		if (clientSocket.readyState === WebSocket.OPEN) {
			clientSocket.send(data);
		}
	});
}

function videoHudSocketClose(){
	
	if(videoHudSocketCon !== null){
		videoHudSocketCon.end();
	}
}
function videoHudSocketConnect(){
	if(videoHudSocketCon !== null){
		console.log("hud socket not connecting, already connected");
		return;
	}

	console.log("hud socket connecting to "+videoHudSocket);
	var newConnection = net.createConnection(videoHudSocket, function() {
		videoHudSocketCon = newConnection;
		console.log("hud socket connected");
	});

	newConnection.on("close", function(hadError ) {
		console.log("hud socket closed, hadError: ", hadError);
		videoHudSocketCon = null;
		if(videoRunning === true){
			setTimeout(videoHudSocketConnect, 2000);
		}
	});

	newConnection.on("error", function(error) {
		console.log("hud socket error ", error.code);
	});

	newConnection.on("data", function(data) {
		console.log("hud socket data received ", data);
	});
}
function videoHudSocketSendMessage(message){
	if(videoHudSocketCon === null){
		console.log("hud socket send failed, not connected");
		return;
	}
	videoHudSocketCon.write(message+'\n');
}
function overlayUpdateScore(){
	
	videoHudSocketSendMessage('{"text":"Score: '+shootingScore+'","x":10,"y":90,"id":"score","expires":false}');
}
function overlayStartTimer(){

	videoHudSocketSendMessage('{"text":"SHOOT!","x":10,"y":120,"id":"shoot","expires":false}');
	videoHudSocketSendMessage('{"timer":true,"id":"shoottimer","duration":'+shootingTimerDurationSecond+',"x":86,"y":120}');
	videoHudSocketSendMessage('{"img":"crosshair1px.png","id":"crosshair","x":390,"y":150}');

	overlayUpdateScore();
	
	if(hideScoreDelay !== null){
		clearTimeout(hideScoreDelay);
	}
	hideScoreDelay = setTimeout(function(){
		hideScoreDelay = null;
		shootingRoundActive = false;
		videoHudSocketSendMessage('{"hide":"shoot"}');
		videoHudSocketSendMessage('{"hide":"crosshair"}');

		setTimeout(function(){
			videoHudSocketSendMessage('{"hide":"score"}');
		}, 4 * 1000);
	}, shootingTimerDurationSecond * 1000);
}
function overlayStopTimer(){
	videoHudSocketSendMessage('{"hide":"shoottimer"}');
	videoHudSocketSendMessage('{"hide":"score"}');
	videoHudSocketSendMessage('{"hide":"shoot"}');
	videoHudSocketSendMessage('{"hide":"crosshair"}');
}
function stopVideoProcess(){
	if(FfmpegVideoProcess !== null){
		FfmpegVideoProcess.kill();
	}
	if(FfmpegAudioProcess !== null){
		FfmpegAudioProcess.kill();
	}
}
function startVideoProcess(){
	if(videoRunning === true){
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
        '-hide_banner',
        '-nostats',
        '-loglevel','quiet',
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
		'http://127.0.0.1:8080/sendAudio/?streamKey=supersecret'
	], {stdio: [process.stdin, process.stdout, process.stderr]});
	audioRunning = true;
	
	FfmpegAudioProcess.on('exit', (code) => {
		console.log('startVideo() - ffmpeg AUDIO process exited');
		audioRunning = false;
		FfmpegAudioProcess = null;
	});

	// FfmpegAudioProcess.stdout.on('data', (data) => {
	//   console.log(data.toString());
	// });
	
	// FfmpegAudioProcess.stderr.on('data', (data) => {
	//   console.error(data.toString());
	// });

	// FfmpegAudioProcess.stdout.pipe(process.stdout);
	// FfmpegAudioProcess.stderr.pipe(process.stderr);


	FfmpegVideoProcess = spawn('python', ['gel_blaster_camera_hud.py'], {stdio: [process.stdin, process.stdout, process.stderr]});
	videoRunning = true;
	
	videoHudSocketConnect();
	
	FfmpegVideoProcess.on('exit', (code) => {
		console.log('startVideo() - ffmpeg VIDEO process exited');
		videoRunning = false;
		FfmpegVideoProcess = null;
		videoHudSocketClose();
	});
	
	//FfmpegVideoProcess.stdout.pipe(process.stdout);
	//FfmpegVideoProcess.stderr.pipe(process.stderr);

	// FfmpegVideoProcess.stdout.on('data', (data) => {
	//   console.log(data.toString());
	// });
	
	// FfmpegVideoProcess.stderr.on('data', (data) => {
	//   console.error(data.toString());
	// });
	
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
			if(internetVideoStarted){
				internetVideoSendVideoData(data);
			}
		});
		req.on('end',function(){
			console.log('sendVideo client closed');
		});

		return;
	}


	if(parsedUrl.pathname.indexOf('/sendAudio') != -1){

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
			'Incoming Audio Stream Connected: ' + 
			req.socket.remoteAddress + ':' +
			req.socket.remotePort
		);
		req.on('data', function(data){
			broadcastAudioData(data);
			if(internetVideoStarted){
				internetVideoSendAudioData(data);
			}
		});
		req.on('end',function(){
			console.log('sendAudio client closed');
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
		case '/viewAudio': 
			audioServer.handleUpgrade(request, socket, head, function done(ws) {
				audioServer.emit('connection', ws, request);
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

	targetWebsocketClose();
	videoHudSocketClose();

	process.exit(-1);
});
