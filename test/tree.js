"use strict"
//--------------------------------- 80 chars -----------------------------------

const _ = require('lodash/fp');

const genElement = () => ({id: _.uniqueId(), toString(){return `Dummy #${this.id}`}});

const chai = require('chai');
chai.use(require('chai-as-promised'));
chai.should();

const Tree = require('../tree.js');

describe('#tree', () => {
	const t = new Tree;
	const [a,b,c,d] = _.range(0,4).map(genElement);
	const g = null, h = undefined, i = 'some string';
	it('allows one to add directed relations between arbitrary objects', () => {
		t.setRelation(a, b);
		t.setRelation(b, c, d);
		t.setRelation(c, g, h);
		t.setRelation(g, h);
		t.getDirectChildren(a).should.be.an.instanceOf(Set);
		t.getDirectChildren(a).size.should.equal(1);
		t.getDirectChildren(b).size.should.equal(2);
		[...t.getDirectChildren(b)].map(_.prop('id')).should.have.members([c,d].map(_.prop('id')));

		t.setRelation(a, g, h, i);
		t.getDirectChildren(a).should.be.an.instanceOf(Set);
		t.getDirectChildren(a).size.should.equal(4);
	});	
	it('notes the difference between direct relation and indirect one', () => {
		t.getDirectChildren(a).should.be.an.instanceOf(Set);
		t.getDirectChildren(a).size.should.equal(4);

		t.getAllChildren(a).should.be.an.instanceOf(Set);
		t.getAllChildren(a).size.should.equal(4 + 2);
	});
	it('returns values that can be modified without affecting stored relations', () => {
		const bChildren = t.getDirectChildren(b);
		const bChildrenLengthBefore = bChildren.size;
		bChildren.add(i);
		t.getDirectChildren(b).size.should.equal(bChildrenLengthBefore);
	});
	it('throws an error when one tries to make circular relation', () => Promise.resolve().then(() => {
		t.setRelation(b, a);
	}).should.be.rejectedWith(Error));
	it('throws an error when one tries to make element reference itself', () => Promise.resolve().then(() => {
		t.setRelation(b, b);
	}).should.be.rejectedWith(Error));
	it('allows overriding those errors', () => {
		const [selfElement, cycleP, cycleC] = _.range(0,3).map(genElement);
		const customThrowingTree = new Tree({
			onSelfRelation: (element) => {
				element.should.equal(selfElement);
				throw new Error('ok');
			},
			onCycleAttempt: (parent, child, path) => {
				parent.should.equal(cycleP);
				child.should.equal(cycleC);
				throw new Error('ok');
			}
		});
		const dummy = (...args) => null;
		const customNonThrowingTree = new Tree({onSelfRelation:dummy, onCycleAttempt:dummy});
		 
		const throwSelfElement = new Promise(() => {
			customThrowingTree.setRelation(selfElement,selfElement);
		}).should.be.rejectedWith('ok');

		const throwCycleElement = new Promise(() => {
			customThrowingTree.setRelation(cycleC, cycleP);
			customThrowingTree.setRelation(cycleP, cycleC); // throws here
		}).should.be.rejectedWith('ok');

		const ensureCustomSelfThrow = new Promise(() => {
			customNonThrowingTree.setRelation(selfElement, selfElement);
		}).should.be.rejectedWith('Logic error');

		const ensureCustomCycleThrow = new Promise(() => {
			customNonThrowingTree.setRelation(cycleC, cycleP);
			customNonThrowingTree.setRelation(cycleP, cycleC);
		}).should.be.rejectedWith('Logic error');

		return Promise.all([
			throwSelfElement,
			throwCycleElement,
			ensureCustomSelfThrow,
			ensureCustomCycleThrow
		]);
	});
});


