import * as THREE from 'three/webgpu';
import {
	Fn, If, uniform, instancedArray, instanceIndex, hash, vec3, sin, cos, time,
	deltaTime, positionLocal, rotate, varying, mix, length, TWO_PI
} from 'three/tsl';
import { palette, night } from './materials.js';
import { CAKE_R } from './world.js';

// ---------- GPU sprinkle rain (compute shader) ----------

export class SprinkleRain {

	constructor( count = 6000 ) {

		this.count = count;
		this.speed = uniform( 1 );

		const pos = instancedArray( count, 'vec3' );

		this.init = Fn( () => {

			const i = instanceIndex;
			const a = hash( i ).mul( TWO_PI );
			const r = hash( i.add( 7 ) ).sqrt().mul( 90 );
			pos.element( i ).assign( vec3( cos( a ).mul( r ), hash( i.add( 13 ) ).mul( 110 ).sub( 40 ), sin( a ).mul( r ) ) );

		} )().compute( count );

		this.update = Fn( () => {

			const i = instanceIndex;
			const p = pos.element( i );
			const fall = hash( i.add( 21 ) ).mul( 2.5 ).add( 1.5 ).mul( this.speed );
			p.y.subAssign( fall.mul( deltaTime ) );
			const sway = sin( time.mul( 0.6 ).add( p.y.mul( 0.12 ) ).add( hash( i ).mul( 6.28 ) ) );
			p.x.addAssign( sway.mul( deltaTime ).mul( 0.8 ) );
			p.z.addAssign( cos( time.mul( 0.5 ).add( p.y.mul( 0.1 ) ) ).mul( deltaTime ).mul( 0.6 ) );
			const landed = p.y.lessThan( 0.2 ).and( p.y.greaterThan( - 1 ) ).and( length( p.xz ).lessThan( CAKE_R ) );
			If( p.y.lessThan( - 40 ).or( landed ), () => {

				p.y.assign( 70 );

			} );

		} )().compute( count );

		const mat = new THREE.MeshBasicNodeMaterial( { fog: true } );
		const h1 = hash( instanceIndex.add( 101 ) ), h2 = hash( instanceIndex.add( 202 ) ), h3 = hash( instanceIndex.add( 303 ) );
		const spin = vec3( time.mul( h1.mul( 3 ).add( 1 ) ), time.mul( h2.mul( 2 ) ), h3.mul( 6.28 ) );
		mat.positionNode = rotate( positionLocal, spin ).add( pos.toAttribute() );
		const c = varying( palette( hash( instanceIndex.add( 9 ) ) ) );
		mat.colorNode = c.mul( mix( 1.05, 0.55, night ) ).add( c.mul( night ).mul( 0.6 ) );

		this.mesh = new THREE.InstancedMesh( new THREE.CapsuleGeometry( 0.05, 0.24, 2, 6 ), mat, count );
		this.mesh.frustumCulled = false;

	}

}

// ---------- CPU particle pool (bursts and fireworks) ----------

class Pool {

	constructor( geometry, material, max ) {

		this.max = max;
		this.mesh = new THREE.InstancedMesh( geometry, material, max );
		this.mesh.frustumCulled = false;
		this.mesh.count = 0;
		this.mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		this.mesh.setColorAt( 0, new THREE.Color() );
		this.mesh.instanceColor.setUsage( THREE.DynamicDrawUsage );
		this.p = [];
		this._m = new THREE.Matrix4();
		this._q = new THREE.Quaternion();
		this._s = new THREE.Vector3();
		this._c = new THREE.Color();

	}

	spawn( o ) {

		if ( this.p.length >= this.max ) this.p.shift();
		o.age = 0;
		o.axis ??= new THREE.Vector3( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 ).normalize();
		o.rot = Math.random() * 6;
		this.p.push( o );
		return o;

	}

	update( dt, step ) {

		const alive = [];
		for ( const o of this.p ) {

			o.age += dt;
			if ( o.age < o.life && step( o, dt ) !== false ) alive.push( o );

		}

		this.p = alive;
		const arr = this.mesh.instanceMatrix.array;
		const col = this.mesh.instanceColor.array;
		for ( let i = 0; i < alive.length; i ++ ) {

			const o = alive[ i ];
			const k = o.fade ? Math.pow( 1 - o.age / o.life, 0.6 ) : Math.min( 1, ( o.life - o.age ) * 3 );
			const s = o.size * k * ( o.twinkle ? 0.6 + 0.4 * Math.sin( o.age * 40 + i ) : 1 );
			this._q.setFromAxisAngle( o.axis, o.rot );
			this._m.compose( o.pos, this._q, this._s.setScalar( Math.max( s, 0.0001 ) ) );
			this._m.toArray( arr, i * 16 );
			col[ i * 3 ] = o.color.r; col[ i * 3 + 1 ] = o.color.g; col[ i * 3 + 2 ] = o.color.b;

		}

		this.mesh.count = alive.length;
		this.mesh.instanceMatrix.needsUpdate = true;
		this.mesh.instanceColor.needsUpdate = true;

	}

}

const SPRINKLE_COLS = [ 0xff3b7f, 0x39d98a, 0xffb627, 0x8f6bff, 0x2ec5ff, 0xffffff, 0xfff05a ].map( ( c ) => new THREE.Color( c ) );
const FW_COLS = [ 0xff4fa0, 0x6cf0ff, 0xfff06a, 0xa98bff, 0x7dff9b, 0xff9a5a ].map( ( c ) => new THREE.Color( c ) );

export class Effects {

	constructor( scene, camera, audio ) {

		this.camera = camera;
		this.audio = audio;

		this.sprinkles = new Pool(
			new THREE.CapsuleGeometry( 0.09, 0.42, 2, 8 ),
			new THREE.MeshStandardNodeMaterial( { roughness: 0.35 } ),
			2500
		);
		this.sprinkles.mesh.castShadow = true;

		const sparkMat = new THREE.MeshBasicNodeMaterial( { fog: false } );
		this.sparkPool = new Pool( new THREE.IcosahedronGeometry( 0.16, 1 ), sparkMat, 6000 );
		this.rockets = [];

		scene.add( this.sprinkles.mesh, this.sparkPool.mesh );

	}

	// A fountain of sprinkles from a point.
	burst( at, n = 60, power = 1 ) {

		for ( let i = 0; i < n; i ++ ) {

			const a = Math.random() * Math.PI * 2;
			const up = 0.45 + Math.random() * 0.9;
			const sp = ( 5 + Math.random() * 9 ) * power;
			this.sprinkles.spawn( {
				pos: at.clone(),
				vel: new THREE.Vector3( Math.cos( a ) * sp * ( 1 - up * 0.5 ), sp * up * 1.3, Math.sin( a ) * sp * ( 1 - up * 0.5 ) ),
				spin: ( Math.random() - 0.5 ) * 30,
				size: 0.8 + Math.random() * 0.6,
				color: SPRINKLE_COLS[ ( Math.random() * SPRINKLE_COLS.length ) | 0 ],
				life: 3 + Math.random() * 2
			} );

		}

	}

	// Launch a firework rocket from a point.
	launch( from, delay = 0 ) {

		this.rockets.push( {
			pos: from.clone(),
			vel: new THREE.Vector3( ( Math.random() - 0.5 ) * 6, 30 + Math.random() * 12, ( Math.random() - 0.5 ) * 6 ),
			delay,
			color: FW_COLS[ ( Math.random() * FW_COLS.length ) | 0 ],
			shape: Math.random() < 0.3 ? 'heart' : Math.random() < 0.5 ? 'ring' : 'sphere',
			launched: false
		} );

	}

	show( origins, n = 10 ) {

		for ( let i = 0; i < n; i ++ ) this.launch( origins[ i % origins.length ], i * 0.28 + Math.random() * 0.2 );

	}

	explode( r ) {

		const c = r.color;
		const c2 = FW_COLS[ ( Math.random() * FW_COLS.length ) | 0 ];
		const hdr = ( col, k ) => col.clone().multiplyScalar( k );
		const add = ( dir, speed, col ) => this.sparkPool.spawn( {
			pos: r.pos.clone(),
			vel: dir.multiplyScalar( speed ),
			size: 1 + Math.random() * 0.8,
			color: hdr( col, 5 + Math.random() * 3 ),
			life: 1.6 + Math.random() * 1.1,
			drag: 1.3,
			twinkle: Math.random() < 0.5,
			fade: true
		} );

		if ( r.shape === 'heart' ) {

			const right = new THREE.Vector3().setFromMatrixColumn( this.camera.matrixWorld, 0 );
			const up = new THREE.Vector3().setFromMatrixColumn( this.camera.matrixWorld, 1 );
			for ( let i = 0; i < 160; i ++ ) {

				const t = ( i / 160 ) * Math.PI * 2;
				const x = 16 * Math.pow( Math.sin( t ), 3 );
				const y = 13 * Math.cos( t ) - 5 * Math.cos( 2 * t ) - 2 * Math.cos( 3 * t ) - Math.cos( 4 * t );
				const d = right.clone().multiplyScalar( x / 16 ).addScaledVector( up, y / 16 );
				add( d, 17, i % 2 ? c : hdr( new THREE.Color( 0xff4f8b ), 1 ) );

			}

		} else if ( r.shape === 'ring' ) {

			const n = new THREE.Vector3( Math.random() - 0.5, 1, Math.random() - 0.5 ).normalize();
			const t1 = new THREE.Vector3( 1, 0, 0 ).cross( n ).normalize();
			const t2 = n.clone().cross( t1 );
			for ( let i = 0; i < 120; i ++ ) {

				const a = ( i / 120 ) * Math.PI * 2;
				add( t1.clone().multiplyScalar( Math.cos( a ) ).addScaledVector( t2, Math.sin( a ) ), 16, i % 3 ? c : c2 );

			}

			for ( let i = 0; i < 60; i ++ ) add( randDir(), 6 + Math.random() * 3, c2 );

		} else {

			for ( let i = 0; i < 220; i ++ ) add( randDir(), 11 + Math.random() * 7, Math.random() < 0.75 ? c : c2 );

		}

		this.audio?.boom();

	}

	update( dt ) {

		const g = 22;
		this.sprinkles.update( dt, ( o, h ) => {

			o.vel.y -= g * h;
			o.pos.addScaledVector( o.vel, h );
			o.rot += o.spin * h;
			const r = Math.hypot( o.pos.x, o.pos.z );
			if ( o.pos.y < 0.1 && o.pos.y > - 1.5 && r < CAKE_R ) {

				o.pos.y = 0.1;
				o.vel.y *= - 0.35;
				o.vel.x *= 0.6; o.vel.z *= 0.6;
				o.spin *= 0.5;

			}

			return o.pos.y > - 60;

		} );

		for ( const r of this.rockets ) {

			if ( r.delay > 0 ) {

				r.delay -= dt;
				continue;

			}

			if ( ! r.launched ) {

				r.launched = true;
				this.audio?.whoosh();

			}

			r.vel.y -= 14 * dt;
			r.pos.addScaledVector( r.vel, dt );
			// Glittering trail
			for ( let k = 0; k < 2; k ++ ) {

				this.sparkPool.spawn( {
					pos: r.pos.clone().add( new THREE.Vector3( ( Math.random() - 0.5 ) * 0.3, - Math.random() * 0.5, ( Math.random() - 0.5 ) * 0.3 ) ),
					vel: new THREE.Vector3( ( Math.random() - 0.5 ) * 1.5, - 2 - Math.random() * 2, ( Math.random() - 0.5 ) * 1.5 ),
					size: 0.7, color: new THREE.Color( 4, 3.2, 2.2 ), life: 0.5 + Math.random() * 0.4, drag: 2, fade: true
				} );

			}

			if ( r.vel.y < 4 ) {

				r.done = true;
				this.explode( r );

			}

		}

		this.rockets = this.rockets.filter( ( r ) => ! r.done );

		this.sparkPool.update( dt, ( o, h ) => {

			o.vel.multiplyScalar( Math.exp( - o.drag * h ) );
			o.vel.y -= 4.5 * h;
			o.pos.addScaledVector( o.vel, h );

		} );

	}

}

function randDir() {

	const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt( 1 - u * u );
	return new THREE.Vector3( s * Math.cos( a ), u, s * Math.sin( a ) );

}
