"use strict"
//--------------------------------- 80 chars -----------------------------------

const EventEmitter = require('events');
let verboseLevel = 1;
const setVerboseLevel = (l) => {verboseLevel = l};
const vlog = function(...stuff) {
	if (verboseLevel) {
		console.log(...stuff);
	}
};

const vvlog = function(...stuff) {
	if (verboseLevel > 1) {
		console.log(...stuff);
	}
};

//TODO: DON"T MODIFY SET
// some set shenanigans. TODO: move to a separate package.

const setUnionCore = (a, b) => {
	const result = new Set(a);
	for (const elem of b) {
		result.add(elem);
	}
	return result;
};

Set.prototype.union = function(...sets) {
	return [this, ...sets].reduce(setUnionCore); // iteration would be faster tbh
}

Set.prototype.difference = function(...sets) {
	const result = new Set(this);
	for (const set of sets) {
		if (!result.size) {
			break;
		}
		for (const elem of set) {
			result.delete(elem);
		}
	}
	return result;
};

Set.prototype.map = function(callback, thisArg) {
	const result = new Set();
	for (const elem of this) {
		//TODO: use thisArg too
		result.add(callback(elem));
	}
	return result;
};



Set.prototype.filter = function(callback, thisArg) {
	const result = new Set();
	for (const elem of this) {
		//TODO: use thisArg too
		if (callback(elem)) {
			result.add(elem);
		}
	}
	return result;
};

const argumentCountDispatch = (methods) => (...params) => methods[params.length](...params);
const takeSomeMethods = argumentCountDispatch({
	4: (cls, ...methods) => class {
		constructor() {this['_' + cls.name] = new cls();}
		[methods[0]](..._) {return this['_' + cls.name][methods[0]].bind(this['_' + cls.name])(..._);}
		[methods[1]](..._) {return this['_' + cls.name][methods[1]].bind(this['_' + cls.name])(..._);}
		[methods[2]](..._) {return this['_' + cls.name][methods[2]].bind(this['_' + cls.name])(..._);}
	}
});


// TODO: use EventEmitter or something instead of reinventing event handling
const StatefulObject = (states) => class StatefulObject extends takeSomeMethods(EventEmitter, 'emit', 'on', 'removeListener') {
	constructor(state) {
		super();
		if (!state) {
			state = states[0];
		}
		this._state = state;
		this._stateTimestamp = Date.now();

		// we don't have class properties yet:(
		Object.defineProperty(this, 'allowedStates', {
			enumerable: false,
			value: states
		});
	}
	state(newState, ...payload) {
		if (!newState) {
			return this._state;
		}
		if (states.indexOf(newState) >= 0) {
			vvlog(`${this.name}: ${this._state} -> ${newState}`);
			this.emit(`leaveState:${this._state}`, ...payload);
			this._state = newState;
			this._stateTimestamp = Date.now();
			this.emit(`enterState:${newState}`, ...payload);
			return this;
		}
		throw new Error(`'${newState}' is not a valid state, valid ones are ${states}`);
	}
	onEnter(state, callback) {this.on(`enterState:${state}`, callback);}
	offEnter(state, callback) {this.removeListener(`enterState:${state}`, callback);}
	onLeave(state, callback) {this.on(`leaveState:${state}`, callback);}
	offLeave(state, callback) {this.removeListener(`leaveState:${state}`, callback);}
};

// TODO: move dependency-resolving stuff (not related to states) to a separate class
const units = new Map(), dependants = new Map(), dependencies = new Map();

const allowedStates = ['idle', 'waiting for deps', 'starting', 'running', 'stopping', 'waiting for deps to stop', 'stopped'];
class Unit extends StatefulObject(allowedStates) {
	constructor(name, setupFunc, teardownFunc) {
		if (!name) {
			throw new Error('Unit must have a unique name. Make it meaningful and fancy.');
		}
		if (units.get(name)) {
			throw new Error(`Unit '${name}' already exists.`);
		}
		super();
		this.name = name;
		units.set(name, this);
		dependencies.set(this, new Set());
		dependants.set(this, new Set());
		if (setupFunc) {
			this.setSetupFunc(setupFunc);
		}
		if (teardownFunc) {
			this.setTeardownFunc(teardownFunc);
		}

		this.onEnter('waiting for deps', () => {
			const unsatisfiedDeps = dependencies.get(this).filter((unit) => unit.state() !== 'running');
			vvlog(`${this.name}: ${unsatisfiedDeps.size} unsatisfied deps:`, ...unsatisfiedDeps.map(u=>u.name));
			if (unsatisfiedDeps.size) {
				process.nextTick(() => {this.startDeps();});
			} else {
				this.state('starting');
			}
			if (this.startTimeout) {
				setTimeout(() => {
					const currentState = this.state();
					if (currentState == 'waiting for deps' || currentState == 'starting') {
						this.state('waiting for deps to stop');
					}
				}, this.startTimeout);
			}
		});

		this.onEnter('starting', () => {
			const fun = ((this.setupFunc) || ((yay, nay) => yay()));
			fun(
				() => {this.state('running');},
				(error) => {this.state('stopping', error);}
			);
		});

		this.onEnter('running', () => {
			vlog(`${this.name}: running`);
			dependants.get(this).filter((unit) => 'waiting for deps' == unit.state()).map((unit) => unit.notifyDepReady());
		});

		const allowedStates = new Set(this.allowedStates);
		const dependencyFailureCascadeStates = allowedStates.difference(['idle', 'stopping', 'stopped']);

		this.onEnter('stopping', (error = 'unknown error') => {
			// First, we launch cleanup. Then we notify dependants and after that - dependencies.
			// This guarantees that at most 1 dep is dead during synchronous part of cleanup.

			const fun = ((this.teardownFunc) || ((yay, nay) => yay()));
			fun(
				() => {this.state('waiting for deps to stop');},
				(error) => {
					console.log(`${error} was encountered while shutting down ${this.name}`);
					this.state('waiting for deps to stop');
				}
			);

			dependants.get(this)
				.filter((unit) => dependencyFailureCascadeStates.has(unit.state()))
				.map((unit) => unit.state('stopping', {name : error}));

			dependencies.get(this)
				.filter((unit) => dependencyFailureCascadeStates.has(unit.state()))
				.map((unit) => unit.state('stopping', 'stopped by parent'));
		});

		this.onEnter('waiting for deps to stop', () => {
			if (!this.getStoppingDeps().size) {
				this.state('stopped');
			} else {
				// we'll have to rely on signals from dependencies
			}
		});

		this.onEnter('stopped', () => {
			vlog(`${this.name}: stopped.`);
			dependants.get(this)
				.filter((unit) => 'waiting for deps to stop' == unit.state())
				.map((unit) => unit.notifyDepStopped());
		});

	};
	// TODO: allow requiring several units
	requires(unit) {
		if (unit) {
			this.setRequires(unit);
			return this;
		} else {
			return this.getAllDependencies();
		}
	}
	setRequires(unit) {
		if (typeof(unit) == 'string') {
			if (!units.get(unit)) {
				throw new Error(`Unit ${this.name} tried to require unknown unit ${unit}.`);
			} else {
				unit = units.get(unit);
			}
		}
		if (unit.requires().has(this)) {
			throw new Error(`Circular dependency: ${unit.name} already requires ${this.name}`);
		}
		if (unit instanceof MainUnit) {
			throw new Error(`${this.name} tried requiring main unit ${unit.name}`);
		}
		if (unit.name == this.name) {
			throw new Error(`${this.name} tried to require itself`);
		}
		dependencies.get(this).add(unit);
		dependants.get(unit).add(this);
	}
	getAllDependencies() {
		const directDeps = dependencies.get(this);
		return directDeps.union(...directDeps.map((unit) => unit.getAllDependencies()));
	}
	getAllDependants(){
		const directDeps = dependants.get(this);
		return directDeps.union(...directDeps.map((unit) => unit.getAllDependants()));
	}
	setSetupFunc(fun) {
		if (this.setupFunc) {
			throw new Error(`Setup function already defined for ${this.name}.`);
		}
		this.setupFunc = fun;
		return this;
	}
	setTeardownFunc(fun) {
		if (this.teardownFunc) {
			throw new Error(`Teardown function already defined for ${this.name}.`);
		}
		this.teardownFunc = fun;
		return this;
	}
	toString() { // console.log ignores this unfortunately
		return this.name;
	}
	startDeps() { // start all direct deps that have state 'idle', return number of them
		return dependencies.get(this)
			.filter((unit) => 'idle' == unit.state())
			.map((unit) => unit.state('waiting for deps'))
			.size;
	}
	notifyDepReady() {
		const unsatisfiedDeps = dependencies.get(this).filter((unit) => unit.state() !== 'running');
		vvlog(`${this.name}: notified. ${unsatisfiedDeps.size} unsatisfied deps: `, ...unsatisfiedDeps.map(u=>u.name));
		if (!unsatisfiedDeps.size) {
			process.nextTick(() => this.state('starting'));
		}
	}
	notifyDepStopped() {
		if ('waiting for deps to stop' == this.state() && !this.getStoppingDeps().size) {
			this.state('stopped');
		}
	}
	getStoppingDeps () {
		const stoppingDepsStates = new Set(['stopping', 'waiting for deps to stop']);
		const stoppingDeps = dependencies.get(this).filter((unit) => stoppingDepsStates.has(unit.state()));
		vvlog(`${this.name}: ${stoppingDeps.size} deps need to stop:`, ...stoppingDeps.map((u) => `${u.name} (${u.state()})`));
		return stoppingDeps;
	}
};

// TODO: check if this can be done via class that takes another class in constructor
const singleton = (cls) => {
	let result;
	result = class Singleton extends cls {
		constructor(...params) {
			if (result.instance) {
				throw new Error('Attempted creating second instance of singletoned class');
			}
			super(...params);
			result.instance = this;
		}
	}
	result.getInstance = (...params) => result.instance || new result(...params);
	return result;
}

// TODO: handle events
class MainUnit extends singleton(Unit) {
	constructor(name = 'server', ...params) {
		super(name, ...params);
		this.onEnter('stopped', (yay, nay) => {
			vlog('All units stopped.');
			process.exit();
		});
		[
			'exit',
			'SIGHUP',
			'SIGINT',
			'SIGQUIT',
			'SIGILL',
			'SIGTRAP',
			'SIGABRT',
			'SIGBUS',
			'SIGFPE',
			'SIGUSR1',
			'SIGSEGV',
			'SIGUSR2',
			'SIGPIPE',
			'SIGTERM'
		].map((sig) => {
			process.on(sig, (...stuff) => {
				console.log(`Got ${sig}, time to stop. (${stuff})`);
				this.stop()
			});
		});
		process.on('uncaughtException', console.log);
	}
	start() {
		vlog(`Starting main unit (${this.name}) and all dependencies.`)
		this.state('waiting for deps');
	}
	stop() {
		if ('stopped' == this.state()) {
			return;
		}
		//printUnits();
		vlog(`Stopping main unit (${this.name}) and all dependencies.`)
		this.state('stopping');
	}
}

const printUnits = () => {
	console.log('units:');
	for (const unit of units.values()) {
		console.log(`${unit.name} (${unit.state()})`);
	}
};

module.exports = {
	Unit,
	MainUnit,
	StatefulObject,
	setVerboseLevel
};
