
var canvas, ctx,
    $save,
    $imgW, $imgH,
    $sel;

function init() {
    canvas = document.getElementById('screen');
    ctx = canvas.getContext('2d');
    $save = document.getElementById('save');
    $sel = document.getElementById('sel');
    $imgW = document.getElementById('imgW');
    $imgH = document.getElementById('imgH');
    $imgFileName = document.getElementById('imgFileName');
    bind();
}

function bind() {
    $save.onclick = function (e) {
        var type = $sel.value,
            w = 375,
            h = 667;
        f = $imgFileName.value;
        Canvas2Image.saveAsImage(canvas, w, h, type, f);
    }

}

onload = init;

var WSURL = "ws://" + window.location.host + "/websocket"
/*jshint browser:true*/

// BackFrame stores the latest frame retrieved from the socket. It does no
// other work and can be swapped at any time.
function BackFrame() {
    this.blob = null
}

BackFrame.prototype.swap = function (blob) {
    this.blob = blob
}

BackFrame.prototype.consume = function () {
    var blob = this.blob
    this.blob = null
    return blob
}

BackFrame.prototype.destroy = function () {
    this.consume()
}

// FrontFrame takes a blob from the BackFrame and loads it into an image.
// There are two FrontFrames. One is always loading the next image and one
// is always being used to render the latest fully loaded image. They're
// swapped once loading completes and the process repeats.
function FrontFrame(name) {
    this.name = name
    this.blob = null
    this.image = new Image()
    this.url = null
    this.loading = false
    this.loaded = false
    this.fresh = false

    this.onLoad = function () {
        this.loading = false
        this.loaded = true
        this.fresh = true
    }.bind(this)

    this.onError = function () {
        this.loading = false
        this.loaded = false
    }.bind(this)
}

FrontFrame.prototype.load = function (blob) {
    // If someone's calling load() they're already sure that they don't need
    // the the current frame anymore.
    this.reset()

    // Convenience check that must come after the reset.
    if (!blob) {
        return
    }

    this.blob = blob
    this.url = URL.createObjectURL(this.blob)
    this.loading = true
    this.loaded = false
    this.fresh = false
    this.image.onload = this.onLoad
    this.image.onerror = this.onError
    this.image.src = this.url
}

FrontFrame.prototype.reset = function () {
    this.loading = false
    this.loaded = false
    if (this.blob) {
        this.blob = null
        URL.revokeObjectURL(this.url)
        this.url = null
    }
}

FrontFrame.prototype.consume = function () {
    if (!this.fresh) {
        return null
    }

    this.fresh = false
    return this
}

FrontFrame.prototype.destroy = function () {
    this.reset()
    this.image = null
}

function Pipeline() {
    this.back = new BackFrame()
    this.mid = new FrontFrame('mid')
    this.front = new FrontFrame('front')
}

Pipeline.prototype.push = function (blob) {
    this.back.swap(blob)

    // If the mid frame isn't loading or waiting to be consumed, let's
    // ask it to load this new frame to speed up things.
    if (!this.mid.loading && !this.mid.loaded) {
        this.mid.load(this.back.consume())
    }
}

Pipeline.prototype.consume = function () {
    if (this.mid.loaded) {
        const mid = this.mid
        this.mid = this.front
        this.front = mid
        this.mid.load(this.back.consume())
    } else if (!this.mid.loading) {
        this.mid.load(this.back.consume())
    }

    return this.front.consume()
}

Pipeline.prototype.destroy = function () {
    this.back.destroy()
    this.mid.destroy()
    this.front.destroy()
}

// RenderLoop consumes and renders the pipeline.
function RenderLoop(pipeline, canvas) {
    this.timer = null
    this.pipeline = pipeline
    this.canvas = canvas
    this.g = canvas.getContext('2d')
}

RenderLoop.prototype.start = function () {
    this.stop()
    this.next()
}

RenderLoop.prototype.stop = function () {
    cancelAnimationFrame(this.timer)
}

RenderLoop.prototype.next = function () {
    this.timer = requestAnimationFrame(this.run.bind(this))
}

RenderLoop.prototype.run = function () {
    var frame = this.pipeline.consume()
    if (frame) {
        this.canvas.width = frame.image.width
        this.canvas.height = frame.image.height
        this.g.drawImage(frame.image, 0, 0)
    }
    this.next()
}

var pipeline = new Pipeline()
var canvas = document.getElementById('screen')
var renderLoop = new RenderLoop(pipeline, canvas)

var ws = new WebSocket(WSURL)
ws.binaryType = 'blob'

ws.onclose = function () {
    console.log('onclose', arguments)
    renderLoop.stop()
}

ws.onerror = function () {
    console.log('onerror', arguments)
    renderLoop.stop()
}

ws.onmessage = function (message) {
//        console.log('got jpeg', arguments)
    var blob = new Blob([message.data], {
        type: 'image/jpeg'
    })
    pipeline.push(blob)
}

ws.onopen = function () {
        console.log('onopen', arguments)
        ws.send('1920x1080/0')
        renderLoop.start()
    }
