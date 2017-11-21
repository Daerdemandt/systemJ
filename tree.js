"use strict"
//--------------------------------- 80 chars -----------------------------------

const getOne = (set) => [...set][0];

const defaultHandleCycleAttempt =  (parent, child, path) => {
	const pathMsg = path.map((point) => `"${point}"`).join(' -> ');
	throw new Error(
`Attempted to create a cycle: "${child}" already has "${parent}" as a child or sub-child.
Full path: ${pathMsg}`
	);
};

const defaultHandleSelfRelation = (element) => {
	throw new Error(`Attempted to make "${element}" a child of itself`);	
};

module.exports = class Tree {
	constructor({onCycleAttempt, onSelfRelation} = {}) {
		this.onCycleAttempt = (onCycleAttempt || defaultHandleCycleAttempt);
		this.onSelfRelation = (onSelfRelation || defaultHandleSelfRelation);
		this.logicError = () => {throw new Error('Logic error - we should never get here');};
		this.children = new Map();
	}
	//TODO:
	getPath(parent, child) {
		return ['path is not implemented yet'];
	}
	setOneRelation(parent, child) {
		if (parent === child) { this.onSelfRelation(parent) || this.logicError(); }
		if (this.getAllChildren(child).has(parent)) {
			const path = this.getPath(child, parent);
			this.onCycleAttempt(parent, child, path) || this.logicError();
		}
		if (!this.children.get(parent)) {
			this.children.set(parent, new Set);
		}
		this.children.get(parent).add(child);
	}
	setRelation(parent, ...children) {children.map((child) => this.setOneRelation(parent, child));}
	//TODO:
	//unsetRelation(...)
	getDirectChildren(parent) {return new Set(this.children.get(parent) || []);}
	getAllChildren(parent) {
		const queue = this.getDirectChildren(parent);
		const result = new Set;
		while (queue.size) {
			const child = getOne(queue);
			queue.delete(child);
			result.add(child);
			for (const grandchild of this.getDirectChildren(child)) {
				if (queue.has(grandchild)) continue;
				if (result.has(grandchild)) continue;
				queue.add(grandchild);
			}
		}
		return result;
	}
}
