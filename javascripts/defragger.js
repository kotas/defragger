/**
 * Defragger
 *
 * @requires prototype 1.6.1
 */

(function () {

var MSEC_PER_FRAME           = 50;
var MAX_EMIT_LINE_FRAMES     = 100;
var MIN_EMIT_LINE_FRAMES     = 1;
var SCORE_PER_LINE           = 100;
var SCORE_PER_LEVEL          = 20;
var SCORE_FACTOR_PER_COMBO   = 0.2;
var FADE_OUT_INITIAL_OPACITY = 0.5;
var FADE_OUT_SPEED_BASE      = 0.005;
var FADE_OUT_SPEED_PER_LEVEL = 0.0002;
var SHOOT_MOVING_STEP        = 0.25;
var WORKER_MOVING_STEP       = 0.25;
var LEVEL_UP_INITIAL         = 500;
var LEVEL_UP_FACTOR          = 1.5;
var BLOCK_WIDTH              = 48;
var BLOCK_HEIGHT             = 48;
var PADDING                  = 5;
var COMBO_MESSAGE_INITIAL    = 1.0;
var COMBO_MESSAGE_SPEED      = 0.05;

var Game = function (canvas, images, options) {
	options = options || {};
	this.fieldWidth   = options.fieldWidth  || 6;
	this.fieldHeight  = options.fieldHeight || 10;
	this.maxStock     = options.maxStock    || 15;
	this.level        = options.startLevel  || 0;
	this.maxLevel     = options.maxLevel    || 99;
	this.stock        = options.startStock  || 5;
	this.maxShoots    = options.maxShoots   || 3;
	this.score        = 0;
	this.erasedCount  = 0;
	this.combo        = 0;
	this.comboMax     = 0;
	this.levelUpScore = LEVEL_UP_INITIAL;

	this.field  = new Field(this.fieldWidth, this.fieldHeight);
	this.worker = new Worker(this.fieldWidth);
	this.shoots = [];
	this.view   = new View(this, canvas, images);

	var initialLines = options.initialLines === undefined ? 3 : options.initialLines;
	for (var i = 0; i < initialLines; i++) {
		this.field.emitNextLine();
	}
};
Game.prototype = {

	start: function () {
		this.view.gameStart();
		this.resetNextLineTimer();
		var self = this;
		this.updateTimer = setInterval(function () {
			self.step();
			self.view.renderField();
		}, MSEC_PER_FRAME);
	},

	over: function () {
		clearInterval(this.updateTimer);
		this.view.gameOver();
	},

	emitNextLine: function () {
		if (this.field.emitNextLine()) {
			this.resetNextLineTimer();
		} else {
			this.over();
		}
	},

	resetNextLineTimer: function () {
		this.nextLineTimer = Math.ceil(
			MIN_EMIT_LINE_FRAMES +
			(this.maxLevel - this.level) *
			(MAX_EMIT_LINE_FRAMES - MIN_EMIT_LINE_FRAMES) /
			this.maxLevel
		);
	},

	takeBlock: function (x) {
		if (this.stock < this.maxStock && this.field.takeBlock(x)) {
			this.stock++;
			if (this.field.hasCleanFrontLine())
				this.eraseFrontLine();
			else
				this.view.renderStatus();
		}
	},

	fillBlock: function (x) {
		if (this.stock > 0 && this.field.fillBlock(x)) {
			this.stock--;
			if (this.field.hasCleanFrontLine())
				this.eraseFrontLine();
			else
				this.view.renderStatus();
		}
	},

	eraseFrontLine: function () {
		this.combo = this.field.hasFadingLines() ? this.combo+1 : 0;
		this.comboMax = Math.max(this.combo, this.comboMax);

		this.score += (SCORE_PER_LINE + this.level*SCORE_PER_LEVEL) *
				(1 + this.combo*SCORE_FACTOR_PER_COMBO);
		if (this.score >= this.levelUpScore && this.level < this.maxLevel) {
			this.level++;
			this.levelUpScore *= LEVEL_UP_FACTOR;
			while (this.field.getLineCount() < 5) {
				this.emitNextLine();
			}
		}

		this.erasedCount++;
		this.field.eraseFrontLine();
		this.view.renderStatus();
		this.view.eraseFrontLine();
	},

	moveWorkerLeft: function () {
		this.worker.moveLeft();
	},

	moveWorkerRight: function () {
		this.worker.moveRight();
	},

	shootTake: function () {
		if (this.stock < this.maxStock && this.shoots.length < this.maxShoots) {
			this.shoots.push(new Shoot(this, this.worker.column, Shoot.TYPE_TAKE));
		}
	},

	shootFill: function () {
		if (this.stock > 0 && this.shoots.length < this.maxShoots) {
			this.shoots.push(new Shoot(this, this.worker.column, Shoot.TYPE_FILL));
		}
	},

	step: function () {
		if (--this.nextLineTimer <= 0)
			this.emitNextLine();

		this.worker.step();
		for (var i = this.shoots.length - 1; i >= 0; i--) {
			var row = this.shoots[i].step();
			if (row < this.field.getLineCount()) {
				this.shoots[i].reach();
				this.shoots.splice(i, 1);
			}
		}

		this.field.fadeLines(
			FADE_OUT_SPEED_BASE +
			FADE_OUT_SPEED_PER_LEVEL * this.level);
	}

};


var Block = {
	COLOR_WHITE: 1,
	COLOR_BLACK: 2,
	COLOR_NONE:  0,
	COLOR_ANY:   3,

	chooseRandom: function () {
		var random = Math.random();
		if (random < 0.4) return Block.Empty; // 40%
		if (random < 0.8) return Block.Solid; // 40%
		if (random < 0.9) return Block.Error; // 10%
		return Block.Fixed;                   // 10%
	}
};
Block.Empty = {
	takable: false,
	fillable: true,
	color: Block.COLOR_WHITE,
	imageName: "blockEmpty"
};
Block.Solid = {
	takable: true,
	fillable: false,
	color: Block.COLOR_BLACK,
	imageName: "blockSolid"
};
Block.Error = {
	takable: true,
	fillable: true,
	color: Block.COLOR_NONE,
	imageName: "blockError"
};
Block.Fixed = {
	takable: false,
	fillable: false,
	color: Block.COLOR_ANY,
	imageName: "blockFixed"
};


var Line = function (width) {
	this.opacity = 1.0;
	this.blocks = new Array(width);
	for (var x = 0; x < width; x++) {
		this.blocks[x] = Block.Empty;
	}
};
Line.prototype = {

	setBlock: function (x, block) {
		this.blocks[x] = block;
	},

	getBlock: function (x) {
		return this.blocks[x];
	},

	takeBlock: function (x) {
		var block = this.blocks[x];
		if (block.takable) {
			this.blocks[x] = Block.Empty;
			return true;
		}
		return false;
	},

	fillBlock: function (x) {
		var block = this.blocks[x];
		if (block.fillable) {
			this.blocks[x] = Block.Solid;
			return true;
		}
		return false;
	},

	isClean: function () {
		var color = Block.COLOR_ANY;
		for (var x = 0, b = this.blocks, w = b.length; x < w; x++) {
			color = color & b[x].color;
		}
		return color != 0;
	},

	fade: function (step) {
		this.opacity -= step;
		return this.opacity > 0;
	},

	render: function (ctx, images) {
		ctx.globalAlpha = this.opacity;
		for (var x = 0, l = this.blocks.length; x < l; x++) {
			ctx.drawImage(
				images[this.blocks[x].imageName],
				x * BLOCK_WIDTH, 0,
				BLOCK_WIDTH, BLOCK_HEIGHT
			);
		}
	}

};


var Field = function (width, height) {
	this.width = width;
	this.height = height;
	this.lines = [];
	this.fadingLines = [];
};
Field.prototype = {

	emitNextLine: function () {
		if (this.lines.length < this.height) {
			this.lines.unshift(this._createLine());
			return true;
		}
		return false;
	},

	_createLine: function () {
		var line = new Line(this.width);
		do {
			for (var x = 0, w = this.width; x < w; x++) {
				line.setBlock(x, Block.chooseRandom());
			}
		} while (line.isClean());
		return line;
	},

	getFrontLine: function () {
		return this.lines[this.lines.length - 1];
	},

	getLineCount: function () {
		return this.lines.length;
	},

	takeBlock: function (x) {
		return (this.lines.length > 0 && this.getFrontLine().takeBlock(x));
	},

	fillBlock: function (x) {
		return (this.lines.length > 0 && this.getFrontLine().fillBlock(x));
	},

	hasCleanFrontLine: function () {
		return (this.lines.length > 0 && this.getFrontLine().isClean());
	},

	eraseFrontLine: function () {
		if (this.lines.length > 0) {
			var line = this.lines.pop();
			line.opacity = FADE_OUT_INITIAL_OPACITY;
			this.fadingLines.unshift(line);
			return true;
		}
		return false;
	},

	fadeLines: function (step) {
		if (this.fadeLines.length == 0)
			return;
		for (var i = this.fadingLines.length - 1; i >= 0; i--) {
			if (!this.fadingLines[i].fade(step)) {
				this.fadingLines.pop();
			}
		}
	},

	hasFadingLines: function () {
		return this.fadingLines.length > 0;
	},

	render: function (ctx, images) {
		var y = 0;
		ctx.save();
		for (var i = 0, l = this.lines.length; i < l; i++) {
			this.lines[i].render(ctx, images);
			ctx.translate(0, BLOCK_HEIGHT);
		}
		var remain = this.height - this.lines.length;
		for (var i = 0, l = Math.min(this.fadingLines.length, remain); i < l; i++) {
			var line = this.fadingLines[i];
			ctx.translate(0, (FADE_OUT_INITIAL_OPACITY - line.opacity) * remain * BLOCK_HEIGHT);
			line.render(ctx, images);
			ctx.translate(0, BLOCK_HEIGHT);
		}
		ctx.restore();
	}

};


var Shoot = function (game, col, type) {
	this.game = game;
	this.col = col;
	this.type = type;
	this.floatRow = game.field.height;
};
Shoot.TYPE_FILL = 0;
Shoot.TYPE_TAKE = 1;
Shoot.prototype = {

	reach: function () {
		switch (this.type) {
			case Shoot.TYPE_FILL:
				this.game.fillBlock(this.col);
				break;
			case Shoot.TYPE_TAKE:
				this.game.takeBlock(this.col);
				break;
		}
	},

	step: function () {
		this.floatRow -= SHOOT_MOVING_STEP;
		return Math.floor(this.floatRow);
	},

	render: function (ctx, images) {
		ctx.drawImage(
			images[this.type == Shoot.TYPE_TAKE ? "arm" : "shot"],
			this.col * BLOCK_WIDTH,
			this.floatRow * BLOCK_HEIGHT - (BLOCK_HEIGHT / 2),
			BLOCK_WIDTH,
			BLOCK_HEIGHT
		);
	}

};


var Worker = function (fieldWidth) {
	this.maxColumn = fieldWidth - 1;
	this.column = Math.floor(this.maxColumn / 2);
	this.floatColumn = this.column;

	this.moving = false;
	this.movingDirection = 0;
	this.movingDestination = 0;
};
Worker.prototype = {

	moveLeft: function () {
		if (this.movingDirection != -1 && this.floatColumn > 0) {
			this.moving = true;
			this.movingDirection = -1;
			this.column = Math.max(this.column - 1, 0);
			this.movingDestination = Math.ceil(this.floatColumn - 1);
			return true;
		}
		return false;
	},

	moveRight: function () {
		if (this.movingDirection != +1 && this.floatColumn < this.maxColumn) {
			this.moving = true;
			this.movingDirection = +1;
			this.column = Math.min(this.column + 1, this.maxColumn);
			this.movingDestination = Math.floor(this.floatColumn + 1);
			return true;
		}
		return false;
	},

	step: function () {
		if (this.moving) {
			this.floatColumn += WORKER_MOVING_STEP * this.movingDirection;
			if (
				(this.movingDirection == -1 && this.floatColumn <= this.movingDestination) ||
				(this.movingDirection == +1 && this.floatColumn >= this.movingDestination)
			) {
				this.column = this.floatColumn = this.movingDestination;
				this.moving = false;
				this.movingDirection = 0;
			}
		}
	},

	render: function (ctx, images) {
		ctx.drawImage(images["worker"],
			this.floatColumn * BLOCK_WIDTH, 0,
			BLOCK_WIDTH, BLOCK_HEIGHT);
	}

};


var View = function (game, canvas, images) {
	if (!canvas.getContext)
		throw new Error("<canvas> is not supported by the browser");

	this.game = game;
	this.canvas = canvas;
	this.images = images;

	this.isOver = false;
	this.comboOpacity = 0;
	this.comboMessage = null;
};
View.keyHandlers = {
	37: function () { // left
		this.game.moveWorkerLeft();
	},
	38: function () { // up
		this.game.shootFill();
	},
	39: function () { // right
		this.game.moveWorkerRight();
	},
	40: function () { // down
		this.game.shootTake();
	},
	32: function () { // space
		this.game.emitNextLine();
	}
};
View.prototype = {

	gameStart: function () {
		this.updatePositions();
		this.renderLogo();
		this.renderField();
		this.renderStatus();

		var self = this;
		this.handleKeyDown = function (event) {
			event = window.event || event;
			var handler = View.keyHandlers[event.keyCode || event.charCode];
			if (handler) {
				handler.call(self);
				event.preventDefault();
				event.stopPropagation();
			}
		};
		window.addEventListener("keydown", this.handleKeyDown, false);
	},

	gameOver: function () {
		window.removeEventListener("keydown", this.handleKeyDown, false);

		var ctx = this.canvas.getContext("2d");

		ctx.save();
		this.clipRect(ctx, this.leftArea);
		ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
		ctx.fill();

		ctx.textBaseline = "middle";
		ctx.textAlign = "center";
		ctx.font = "bold 40px Arial";
		ctx.fillStyle = "#FFFFFF";
		ctx.fillText("GameOver", this.leftArea.width / 2, this.leftArea.height / 2);
		ctx.restore();
		this.isOver = true;
	},

	clearRect: function (ctx, rect) {
		ctx.clearRect(rect.left, rect.top, rect.width, rect.height);
	},

	clipRect: function (ctx, rect) {
		ctx.translate(rect.left, rect.top);
		ctx.beginPath();
		ctx.rect(0, 0, rect.width, rect.height);
		ctx.clip();
	},

	updatePositions: function () {
		var fieldWidth  = this.game.field.width * BLOCK_WIDTH,
		    fieldHeight = this.game.field.height * BLOCK_HEIGHT;

		this.fieldArea = {
			left: 0,
			top: 0,
			width: PADDING + fieldWidth + PADDING,
			height: PADDING + fieldHeight + PADDING
		};
		this.workerArea = {
			left: 0,
			top: this.fieldArea.height,
			width: this.fieldArea.width,
			height: PADDING + BLOCK_HEIGHT + PADDING
		};
		this.leftArea = {
			left: 0,
			top: 0,
			width: this.fieldArea.width,
			height: this.fieldArea.height + this.workerArea.height
		};
		this.stockArea = {
			left: this.leftArea.width,
			width: PADDING + 250 + PADDING,
		};
		this.stockArea.cols = Math.floor(this.stockArea.width / BLOCK_WIDTH);
		this.stockArea.rows = Math.ceil(this.game.maxStock / this.stockArea.cols);
		this.stockArea.height = PADDING + this.stockArea.rows * BLOCK_HEIGHT + PADDING;
		this.stockArea.top = this.leftArea.height - this.stockArea.height;
		this.statusArea = {
			left: this.leftArea.width,
			width: this.stockArea.width,
			height: PADDING + 170 + PADDING,
		};
		this.statusArea.top = this.stockArea.top - this.statusArea.height;
		this.logoArea = {
			left: this.leftArea.width + (this.statusArea.width - 200)/2,
			top: 0,
			width: 200,
			height: 200
		};
	},

	renderLogo: function () {
		var ctx = this.canvas.getContext("2d");

		ctx.save();
		this.clearRect(ctx, this.logoArea);
		this.clipRect(ctx, this.logoArea);
		ctx.drawImage(this.images["logo"], 0, 0);
		ctx.restore();
	},

	renderField: function () {
		if (this.isOver) return;

		var ctx = this.canvas.getContext("2d");

		ctx.save();
		this.clearRect(ctx, this.fieldArea);
		this.clipRect(ctx, this.fieldArea);
		ctx.fillStyle = ctx.createLinearGradient(0, 0, 0, this.fieldArea.height);
		ctx.fillStyle.addColorStop(0.5, '#CCCCCC');
		ctx.fillStyle.addColorStop(1, '#999999');
		ctx.fill();
		ctx.translate(PADDING, PADDING);
		this.game.field.render(ctx, this.images);
		for (var i = 0, l = this.game.shoots.length; i < l; i++)
			this.game.shoots[i].render(ctx, this.images);
		ctx.restore();

		ctx.save();
		this.clearRect(ctx, this.workerArea);
		this.clipRect(ctx, this.workerArea);
		ctx.fillStyle = ctx.createLinearGradient(0, 0, 0, 5 + BLOCK_HEIGHT + 5);
		ctx.fillStyle.addColorStop(0, '#000000');
		ctx.fillStyle.addColorStop(1, '#333333');
		ctx.fill();
		ctx.translate(PADDING, PADDING);
		this.game.worker.render(ctx, this.images);
		ctx.restore();

		if (this.comboOpacity > 0) {
			ctx.save();
			this.clipRect(ctx, this.leftArea);
			ctx.globalAlpha = Math.max(0, this.comboOpacity -= COMBO_MESSAGE_SPEED);
			ctx.textBaseline = "middle";
			ctx.textAlign = "center";
			var size = 30 + (1.0-this.comboOpacity) * 30;
			ctx.font = "bold "+size+"px Arial";
			ctx.fillStyle = '#FF0000';
			ctx.fillText(
				this.comboMessage,
				this.leftArea.width / 2,
				this.leftArea.height * 0.7 + this.comboOpacity * 5
			);
			ctx.restore();
		}
	},

	renderStatus: function () {
		var ctx = this.canvas.getContext("2d");

		ctx.save();
		this.clearRect(ctx, this.statusArea);
		this.clipRect(ctx, this.statusArea);
		ctx.fillStyle = "#333333";
		ctx.fill();
		ctx.translate(PADDING, PADDING);

		var fontSize = 40;

		ctx.textBaseline = "top";
		ctx.font = "bold "+fontSize+"px Arial";
		ctx.fillStyle = "#666666";
		ctx.fillText("Score", PADDING, 0);
		ctx.fillText("Level", PADDING, fontSize);
		ctx.fillText("Erased", PADDING, fontSize*2);
		ctx.fillText("M.Combo", PADDING, fontSize*3);

		var w = this.statusArea.width - PADDING - PADDING*2;
		ctx.textAlign = "right";
		ctx.font = "bold "+fontSize+"px Arial";
		ctx.fillStyle = "#FFFFFF";
		ctx.fillText(this.game.score, w, 0);
		ctx.fillText(this.game.level, w, fontSize);
		ctx.fillText(this.game.erasedCount, w, fontSize*2);
		ctx.fillText(this.game.comboMax, w, fontSize*3);
		ctx.restore();

		ctx.save();
		this.clearRect(ctx, this.stockArea);
		this.clipRect(ctx, this.stockArea);
		ctx.fillStyle = "#FFF";
		ctx.fill();
		for (var i = 0, n = this.game.stock; i < n; i++) {
			ctx.drawImage(this.images["shot"],
				(i % this.stockArea.cols) * BLOCK_WIDTH,
				Math.floor(i / this.stockArea.cols) * BLOCK_HEIGHT,
				BLOCK_WIDTH, BLOCK_HEIGHT);
		}
		if (this.game.stock == this.game.maxStock) {
			ctx.globalAlpha = 0.3;
			ctx.fillStyle = "#FF0000";
			ctx.fill();
		}
		ctx.restore();
	},

	eraseFrontLine: function () {
		if (this.game.combo >= 2) {
			this.comboOpacity = COMBO_MESSAGE_INITIAL;
			this.comboMessage = this.game.combo + " Combo!";
		}
	}

};


window.Defragger = {
	start: function (canvas, images, options) {
		var game = new Game(canvas, images, options);
		game.start();
	}
};


})();
