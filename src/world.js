import * as THREE from 'three/webgpu';
import {
	vec3, color, mix, smoothstep, normalize, positionLocal, length, dot, pow, max,
	floor, hash, sin, time, step, float, TWO_PI, cos
} from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as M from './materials.js';
import { night } from './materials.js';

export const CAKE_R = 36;
export const SUN_DIR = new THREE.Vector3( 0.55, 0.62, 0.3 ).normalize();

const rand = ( a, b ) => a + Math.random() * ( b - a );
const pick = ( arr ) => arr[ Math.floor( Math.random() * arr.length ) ];

export const FLAVOURS = [
	[ 0xff5fa2, 0xfff4f8 ], // strawberry
	[ 0x4fd6b0, 0xf2fff9 ], // mint
	[ 0xa98bff, 0xf7f2ff ], // grape
	[ 0xffc93c, 0xfffbe8 ], // lemon
	[ 0xff7a59, 0xfff1ea ], // peach
	[ 0x5bb8ff, 0xf0f8ff ] // blueberry
];

const GUM_COLORS = [ 0xff3b7f, 0x39d98a, 0xffb627, 0x8f6bff, 0x2ec5ff, 0xff6b3d, 0xfff05a ];

function shadow( obj ) {

	obj.traverse( ( o ) => {

		if ( o.isMesh ) o.castShadow = o.receiveShadow = true;

	} );
	return obj;

}

// ---------- shared geometries ----------

function softServeGeo( R, H, turns = 4, amp = 0.13 ) {

	const pts = [];
	const n = 70;
	for ( let i = 0; i <= n; i ++ ) {

		const t = i / n;
		pts.push( new THREE.Vector2( Math.max( R * Math.pow( 1 - t, 0.8 ), 0.0001 ), t * H ) );

	}

	const geo = new THREE.LatheGeometry( pts, 96 );
	const p = geo.attributes.position;
	for ( let i = 0; i < p.count; i ++ ) {

		const x = p.getX( i ), y = p.getY( i ), z = p.getZ( i );
		const phi = Math.atan2( x, z );
		const t = y / H;
		const k = 1 + amp * Math.sin( phi + t * turns * Math.PI * 2 ) * ( 1 - t * 0.5 );
		p.setXYZ( i, x * k, y, z * k );

	}

	geo.computeVertexNormals();
	return geo;

}

const gumdropGeo = ( () => {

	const pts = [ [ 0, 0 ], [ 0.62, 0 ], [ 0.66, 0.12 ], [ 0.62, 0.38 ], [ 0.5, 0.66 ], [ 0.3, 0.88 ], [ 0.12, 0.97 ], [ 0, 1 ] ]
		.map( ( [ x, y ] ) => new THREE.Vector2( x, y ) );
	const curve = new THREE.SplineCurve( pts );
	return new THREE.LatheGeometry( curve.getPoints( 24 ), 32 );

} )();

const kissGeo = softServeGeo( 0.7, 1.3, 3, 0.18 );
const discGeo = new THREE.CylinderGeometry( 1, 1, 0.32, 64 );
const stickGeo = new THREE.CylinderGeometry( 0.09, 0.09, 1, 12 );
const sphereGeo = new THREE.SphereGeometry( 1, 32, 20 );
const archShape = ( w, h ) => {

	const s = new THREE.Shape();
	s.moveTo( - w / 2, 0 );
	s.lineTo( - w / 2, h - w / 2 );
	s.absarc( 0, h - w / 2, w / 2, Math.PI, 0, true );
	s.lineTo( w / 2, 0 );
	s.lineTo( - w / 2, 0 );
	return s;

};

const windowGeo = new THREE.ExtrudeGeometry( archShape( 0.8, 1.5 ), { depth: 0.25, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 } );

function caneGeo( H, hook = 0.7, r = 0.16 ) {

	const pts = [ new THREE.Vector3( 0, 0, 0 ), new THREE.Vector3( 0, H * 0.5, 0 ), new THREE.Vector3( 0, H, 0 ) ];
	for ( let i = 1; i <= 12; i ++ ) {

		const a = Math.PI - ( i / 12 ) * Math.PI;
		pts.push( new THREE.Vector3( hook + hook * Math.cos( a ), H + hook * Math.sin( a ), 0 ) );

	}

	pts.push( new THREE.Vector3( hook * 2, H - hook * 0.5, 0 ) );
	return new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts ), 96, r, 14 );

}

// ---------- gumdrops (one instanced mesh, per-instance hops) ----------

export class Gumdrops {

	constructor( max = 400 ) {

		this.mesh = new THREE.InstancedMesh( gumdropGeo, M.gumdrop(), max );
		this.mesh.count = 0;
		this.mesh.castShadow = this.mesh.receiveShadow = true;
		this.items = [];
		this.hops = new Map();
		this._m = new THREE.Matrix4();
		this._q = new THREE.Quaternion();
		this._e = new THREE.Euler();
		this._c = new THREE.Color();

	}

	add( x, y, z, s, c = pick( GUM_COLORS ) ) {

		const id = this.mesh.count ++;
		this.items[ id ] = { p: new THREE.Vector3( x, y, z ), s, ry: rand( 0, 6.28 ) };
		this.mesh.setColorAt( id, this._c.set( c ) );
		this.write( id, 0, 0 );
		this.mesh.instanceColor.needsUpdate = true;
		return id;

	}

	write( id, lift, squash ) {

		const it = this.items[ id ];
		this._q.setFromEuler( this._e.set( 0, it.ry, 0 ) );
		const sq = Math.max( - 0.5, Math.min( 0.6, squash ) );
		this._m.compose(
			new THREE.Vector3( it.p.x, it.p.y + lift, it.p.z ), this._q,
			new THREE.Vector3( it.s * ( 1 - sq * 0.4 ), it.s * ( 1 + sq ), it.s * ( 1 - sq * 0.4 ) )
		);
		this.mesh.setMatrixAt( id, this._m );
		this.mesh.instanceMatrix.needsUpdate = true;

	}

	hop( id ) {

		if ( ! this.hops.has( id ) ) this.hops.set( id, { t: 0, sq: 0, v: 0 } );

	}

	position( id, out = new THREE.Vector3() ) {

		return out.copy( this.items[ id ].p );

	}

	update( dt ) {

		for ( const [ id, h ] of this.hops ) {

			let lift = 0;
			if ( h.t < 1 ) {

				h.t += dt / 0.65;
				const t = Math.min( h.t, 1 );
				lift = 4 * 2.4 * this.items[ id ].s * t * ( 1 - t );
				this.items[ id ].ry += dt * 10 * ( 1 - t );
				if ( h.t >= 1 ) h.v = - 4;

			}

			h.v += ( - 160 * h.sq - 7 * h.v ) * dt;
			h.sq += h.v * dt;
			this.write( id, lift, h.t < 1 ? 0.25 * Math.sin( h.t * Math.PI ) : h.sq );
			if ( h.t >= 1 && Math.abs( h.sq ) < 1e-3 && Math.abs( h.v ) < 1e-2 ) {

				this.write( id, 0, 0 );
				this.hops.delete( id );

			}

		}

	}

}

// ---------- props ----------

export function lollipop( r = 1.4, stickH = 3.5, flavour = pick( FLAVOURS ) ) {

	const g = new THREE.Group();
	const stick = new THREE.Mesh( stickGeo, M.candyGloss( 0xffffff, { roughness: 0.35 } ) );
	stick.scale.y = stickH;
	stick.position.y = stickH / 2;
	const disc = new THREE.Mesh( discGeo, M.swirl( flavour[ 0 ], flavour[ 1 ], { arms: 2, spiral: 2.6 } ) );
	disc.rotation.x = Math.PI / 2;
	disc.scale.set( r, 1, r );
	const holder = new THREE.Group();
	holder.position.y = stickH + r * 0.85;
	holder.add( disc );
	g.add( stick, holder );
	g.userData.spinner = holder;
	g.userData.top = new THREE.Vector3( 0, stickH + r, 0 );
	return shadow( g );

}

export function candyCane( H = 3.5, flavour = [ 0xff2a4d, 0xffffff ] ) {

	const g = new THREE.Group();
	const L = H + 2.5;
	const m = new THREE.Mesh( caneGeo( H, 0.65, 0.17 ), M.stripes( flavour[ 0 ], flavour[ 1 ], { cu: L * 5, cv: 1, width: 0.45 } ) );
	g.add( m );
	g.userData.top = new THREE.Vector3( 0.6, H + 0.6, 0 );
	return shadow( g );

}

export function iceCream( flavours = [ pick( FLAVOURS ), pick( FLAVOURS ) ] ) {

	const g = new THREE.Group();
	const cone = new THREE.Mesh( new THREE.CylinderGeometry( 0.95, 0.06, 2.8, 32, 1, true ), M.waffle() );
	cone.position.y = 1.4;
	g.add( cone );
	let y = 2.9;
	flavours.forEach( ( f, i ) => {

		const s = new THREE.Mesh( sphereGeo, M.frosting( f[ 0 ], { sprinkleScale: i === flavours.length - 1 ? 40 : 0, density: 0.7 } ) );
		const r = 1.05 - i * 0.12;
		s.scale.set( r, r * 0.92, r );
		s.position.y = y;
		y += r * 1.35;
		g.add( s );

	} );
	const cherry = new THREE.Mesh( sphereGeo, M.candyGloss( 0xe0003a, { roughness: 0.12 } ) );
	cherry.scale.setScalar( 0.3 );
	cherry.position.y = y - 0.25;
	g.add( cherry );
	g.userData.top = new THREE.Vector3( 0, y, 0 );
	return shadow( g );

}

export function kiss( flavour = pick( FLAVOURS ) ) {

	const g = new THREE.Group();
	g.add( new THREE.Mesh( kissGeo, M.stripes( flavour[ 0 ], flavour[ 1 ], { cu: 2, cv: 3, width: 0.55 } ) ) );
	g.userData.top = new THREE.Vector3( 0, 1.3, 0 );
	return shadow( g );

}

function cherry() {

	const g = new THREE.Group();
	const c = new THREE.Mesh( sphereGeo, M.candyGloss( 0xe0003a, { roughness: 0.1 } ) );
	c.scale.setScalar( 0.6 );
	c.position.y = 0.5;
	const stem = new THREE.Mesh(
		new THREE.TubeGeometry( new THREE.QuadraticBezierCurve3(
			new THREE.Vector3( 0, 0.9, 0 ), new THREE.Vector3( 0.1, 1.6, 0 ), new THREE.Vector3( 0.6, 1.9, 0 ) ), 16, 0.05, 6 ),
		M.candyGloss( 0x5a8f2a, { roughness: 0.5 } )
	);
	g.add( c, stem );
	return g;

}

function tower( { r, h, roofH, flavour, icing, turns = 4 } ) {

	const g = new THREE.Group();
	const body = new THREE.Mesh( new THREE.CylinderGeometry( r, r * 1.08, h, 48, 1 ), M.stripes( flavour[ 0 ], flavour[ 1 ], { cu: 6, cv: h / 4 } ) );
	body.position.y = h / 2;
	const foot = new THREE.Mesh( new THREE.TorusGeometry( r * 1.08, 0.38, 12, 48 ), M.frosting( 0xfff6fb ) );
	foot.rotation.x = - Math.PI / 2;
	foot.position.y = 0.25;
	const crown = new THREE.Mesh( new THREE.TorusGeometry( r * 1.05, 0.62, 24, 64 ), M.donut( icing ) );
	crown.rotation.x = - Math.PI / 2;
	crown.position.y = h;
	const roof = new THREE.Mesh( softServeGeo( r * 1.22, roofH, turns ), M.stripes( flavour[ 1 ], flavour[ 0 ], { cu: 2, cv: turns, width: 0.5 } ) );
	roof.position.y = h + 0.1;
	const top = cherry();
	top.position.y = h + roofH - 0.35;
	g.add( body, foot, crown, roof, top );

	for ( let row = 0; row < 2; row ++ ) {

		for ( let i = 0; i < 4; i ++ ) {

			const a = i * Math.PI / 2 + row * Math.PI / 4;
			const w = new THREE.Mesh( windowGeo, M.windowGlow() );
			const y = h * ( 0.42 + row * 0.3 );
			w.position.set( Math.sin( a ) * ( r - 0.05 ), y, Math.cos( a ) * ( r - 0.05 ) );
			w.rotation.y = a;
			g.add( w );

		}

	}

	g.userData.top = new THREE.Vector3( 0, h + roofH + 1, 0 );
	return shadow( g );

}

function cloudGeo() {

	const parts = [];
	const n = 5 + Math.floor( Math.random() * 4 );
	for ( let i = 0; i < n; i ++ ) {

		const s = new THREE.IcosahedronGeometry( rand( 2.2, 4.2 ), 4 );
		s.scale( 1, 0.8, 1 );
		s.translate( ( i - n / 2 ) * rand( 1.8, 2.6 ), rand( - 0.5, 1.8 ), rand( - 1.8, 1.8 ) );
		parts.push( s );

	}

	return mergeGeometries( parts );

}

// ---------- sky, rainbow ----------

function sky() {

	const m = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide, fog: false, depthWrite: false } );
	const d = normalize( positionLocal );
	const y = d.y;
	const sun = vec3( SUN_DIR.x, SUN_DIR.y, SUN_DIR.z );

	const dayCol = mix(
		mix( color( 0xffd6ea ), color( 0xffe9d6 ), smoothstep( - 0.25, 0.02, y ) ),
		mix( color( 0xffc8e4 ), color( 0x9fd0ff ), smoothstep( 0.05, 0.75, y ) ),
		smoothstep( - 0.02, 0.08, y )
	);
	const nightCol = mix( mix( color( 0x1b1440 ), color( 0x5a2a78 ), smoothstep( - 0.3, 0.02, y ) ), color( 0x07061f ), smoothstep( 0.02, 0.6, y ) );

	const cell = floor( d.mul( 260 ) ).add( 1000 );
	const h = hash( cell.x.add( cell.y.mul( 531 ) ).add( cell.z.mul( 1777 ) ) );
	const stars = step( 0.9975, h ).mul( sin( time.mul( 3 ).add( h.mul( 400 ) ) ).mul( 0.4 ).add( 0.8 ) ).mul( smoothstep( 0.0, 0.2, y ) ).mul( 3 );

	const sd = max( dot( d, sun ), 0 );
	const disk = smoothstep( 0.9985, 0.9992, sd );
	const halo = pow( sd, 24 ).mul( 0.5 ).add( pow( sd, 400 ).mul( 1.5 ) );
	const sunCol = color( 0xfff0c8 ).mul( disk.mul( 6 ).add( halo ) ).mul( night.oneMinus() );
	const moonCol = color( 0xdfe6ff ).mul( disk.mul( 3 ).add( halo.mul( 0.5 ) ) ).mul( night );

	m.colorNode = mix( dayCol, nightCol.add( vec3( stars ) ), night ).add( sunCol ).add( moonCol );
	const mesh = new THREE.Mesh( new THREE.SphereGeometry( 800, 64, 32 ), m );
	mesh.renderOrder = - 1;
	return mesh;

}

function rainbow() {

	const m = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide } );
	const p = positionLocal;
	const t = length( p.xy ).sub( 190 ).div( 34 );
	const c = vec3( 0.5 ).add( vec3( 0.5 ).mul( cos( TWO_PI.mul( vec3( t.mul( 0.82 ) ).add( vec3( 0.0, 0.33, 0.67 ) ) ) ) ) );
	m.colorNode = mix( c, vec3( 1 ), 0.1 ).mul( 1.3 );
	m.opacityNode = smoothstep( 0, 0.12, t ).mul( smoothstep( 1, 0.88, t ) ).mul( smoothstep( 0, 70, p.y ) ).mul( float( 0.5 ).mul( night.mul( 0.85 ).oneMinus() ) );
	const mesh = new THREE.Mesh( new THREE.RingGeometry( 190, 224, 160, 1, 0, Math.PI ), m );
	mesh.position.set( - 40, - 60, - 380 );
	mesh.rotation.y = 0.2;
	return mesh;

}

// ---------- build the whole world ----------

export function buildWorld( scene, register ) {

	const updaters = [];
	scene.add( sky(), rainbow() );

	// Cake island
	const cake = new THREE.Group();
	const sponge = new THREE.Mesh( new THREE.CylinderGeometry( CAKE_R, CAKE_R * 0.97, 9, 128, 1 ), M.sponge() );
	sponge.position.y = - 5.1;
	const jam = new THREE.Mesh( new THREE.CylinderGeometry( CAKE_R + 0.15, CAKE_R + 0.15, 1.1, 128, 1, true ), M.frosting( 0xff4f8b ) );
	jam.position.y = - 5.2;
	const top = new THREE.Mesh( new THREE.CylinderGeometry( CAKE_R + 0.6, CAKE_R + 0.6, 1.3, 128, 1 ), M.frosting( 0xffb8d9, { sprinkleScale: 150, density: 0.6 } ) );
	top.position.y = - 0.65;
	const plate = new THREE.Mesh( new THREE.CylinderGeometry( CAKE_R + 4, CAKE_R + 3, 0.8, 128 ), M.candyGloss( 0xfff3fa, { roughness: 0.15 } ) );
	plate.position.y = - 10;
	cake.add( sponge, jam, top, plate );

	// Frosting drips and piped border
	const drips = new THREE.InstancedMesh( new THREE.CapsuleGeometry( 0.7, 1, 6, 12 ), M.frosting( 0xffb8d9 ), 90 );
	const piped = new THREE.InstancedMesh( kissGeo, M.frosting( 0xfffafc ), 110 );
	const mtx = new THREE.Matrix4();
	for ( let i = 0; i < 90; i ++ ) {

		const a = ( i / 90 ) * Math.PI * 2 + rand( - 0.02, 0.02 );
		const len = rand( 0.4, 3.2 );
		mtx.compose(
			new THREE.Vector3( Math.sin( a ) * ( CAKE_R + 0.35 ), - 1.2 - len * 0.6, Math.cos( a ) * ( CAKE_R + 0.35 ) ),
			new THREE.Quaternion(), new THREE.Vector3( 1, len, 0.6 )
		);
		drips.setMatrixAt( i, mtx );

	}

	for ( let i = 0; i < 110; i ++ ) {

		const a = ( i / 110 ) * Math.PI * 2;
		mtx.compose(
			new THREE.Vector3( Math.sin( a ) * ( CAKE_R - 0.3 ), - 0.05, Math.cos( a ) * ( CAKE_R - 0.3 ) ),
			new THREE.Quaternion().setFromEuler( new THREE.Euler( 0, a, 0 ) ), new THREE.Vector3( 1.2, 0.9, 1.2 )
		);
		piped.setMatrixAt( i, mtx );

	}

	cake.add( drips, piped );
	shadow( cake );
	scene.add( cake );
	register( top, { kind: 'ground', label: 'Frosting meadow — click to plant candy' } );
	register( sponge, { kind: 'cake', label: 'Vanilla sponge' } );

	// Chocolate moat + wafer bridge
	const moat = new THREE.Mesh( new THREE.RingGeometry( 20.5, 24, 180, 6 ), M.chocolate() );
	moat.rotation.x = - Math.PI / 2;
	moat.position.y = 0.06;
	moat.receiveShadow = true;
	scene.add( moat );
	register( moat, { kind: 'river', label: 'Chocolate river' } );

	const moatBank = new THREE.Mesh( new THREE.TorusGeometry( 24, 0.35, 10, 160 ), M.frosting( 0xfff6fb ) );
	moatBank.rotation.x = - Math.PI / 2;
	const moatBankIn = moatBank.clone();
	moatBankIn.scale.setScalar( 20.5 / 24 );
	scene.add( shadow( moatBank ), shadow( moatBankIn ) );

	const bridge = new THREE.Mesh( new RoundedBoxGeometry( 5, 0.7, 7, 3, 0.25 ), M.wafer( 0xf2c078, 0xc98a45 ) );
	bridge.position.set( 0, 0.35, 21.8 );
	scene.add( shadow( bridge ) );

	const gumdrops = new Gumdrops( 420 );
	scene.add( gumdrops.mesh );
	register( gumdrops.mesh, { kind: 'gumdrop', label: 'Sugared gumdrop' } );

	// Curtain walls
	const S = 11, WH = 6, WT = 1.6;
	const wallMat = M.wafer( 0xf9a8cb, 0xe46fa3 );
	const capMat = M.frosting( 0xfffafc );
	const walls = new THREE.Group();
	const wall = ( len, x, z, ry ) => {

		const w = new THREE.Mesh( new RoundedBoxGeometry( len, WH, WT, 3, 0.3 ), wallMat );
		w.position.set( x, WH / 2, z );
		w.rotation.y = ry;
		const cap = new THREE.Mesh( new RoundedBoxGeometry( len + 0.2, 0.5, WT + 0.5, 3, 0.22 ), capMat );
		cap.position.set( x, WH + 0.15, z );
		cap.rotation.y = ry;
		walls.add( w, cap );
		const n = Math.floor( len / 1.5 );
		for ( let i = 0; i < n; i ++ ) {

			const o = ( i - ( n - 1 ) / 2 ) * ( len / n );
			const dx = Math.cos( ry ) * o, dz = - Math.sin( ry ) * o;
			gumdrops.add( x + dx, WH + 0.38, z + dz, 0.75 );

		}

	};

	wall( 2 * S, 0, - S, 0 );
	wall( 2 * S, - S, 0, Math.PI / 2 );
	wall( 2 * S, S, 0, Math.PI / 2 );
	wall( S - 2.5, - ( S + 2.5 ) / 2, S, 0 );
	wall( S - 2.5, ( S + 2.5 ) / 2, S, 0 );
	const lintel = new THREE.Mesh( new RoundedBoxGeometry( 5.4, 1.3, WT, 3, 0.3 ), wallMat );
	lintel.position.set( 0, WH - 0.65, S );
	walls.add( lintel );
	scene.add( shadow( walls ) );
	register( walls, { kind: 'wall', label: 'Strawberry wafer walls' } );

	// Gingerbread gate with a candy-cane arch
	const gate = new THREE.Group();
	gate.position.set( 0, 0, S + 0.2 );
	const doorPivot = new THREE.Group();
	doorPivot.position.x = - 2.4;
	const door = new THREE.Mesh( new THREE.ExtrudeGeometry( archShape( 4.8, 4.9 ), { depth: 0.35, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.1 } ), M.candyGloss( 0x9b5a2c, { roughness: 0.6, clearcoat: 0.2 } ) );
	door.position.x = 2.4;
	const knob = new THREE.Mesh( sphereGeo, M.lamp( 0xff3b7f ) );
	knob.scale.setScalar( 0.28 );
	knob.position.set( 4.1, 2.3, 0.55 );
	const heart = new THREE.Mesh( new THREE.ExtrudeGeometry( heartShape(), { depth: 0.15, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 } ), M.candyGloss( 0xff4f8b ) );
	heart.scale.setScalar( 0.12 );
	heart.position.set( 2.4, 3.3, 0.45 );
	heart.rotation.z = Math.PI;
	doorPivot.add( door, knob, heart );
	gate.add( doorPivot );
	const archL = new THREE.Mesh( caneGeo( 5.6, 1.35, 0.3 ), M.stripes( 0xff2a4d, 0xffffff, { cu: 40, cv: 1, width: 0.45 } ) );
	archL.position.set( - 2.7, 0, 1.1 );
	const archR = archL.clone();
	archR.position.x = 2.7;
	archR.scale.x = - 1;
	gate.add( archL, archR );
	scene.add( shadow( gate ) );
	gate.userData.door = doorPivot;
	register( gate, { kind: 'gate', label: 'Gingerbread gate' } );

	// Corner towers
	const towerDefs = [
		{ x: - S, z: - S, flavour: FLAVOURS[ 2 ], icing: 0xffd1ec, label: 'Grape Tower' },
		{ x: S, z: - S, flavour: FLAVOURS[ 1 ], icing: 0xff8fc2, label: 'Mint Tower' },
		{ x: - S, z: S, flavour: FLAVOURS[ 0 ], icing: 0x8fe3ff, label: 'Strawberry Tower' },
		{ x: S, z: S, flavour: FLAVOURS[ 3 ], icing: 0xc6a8ff, label: 'Lemon Tower' }
	];
	const towers = [];
	for ( const d of towerDefs ) {

		const t = tower( { r: 2.6, h: 12, roofH: 7, flavour: d.flavour, icing: d.icing } );
		t.position.set( d.x, 0, d.z );
		scene.add( t );
		register( t, { kind: 'tower', label: d.label } );
		towers.push( t );

	}

	// Keep + great spire
	const keep = new THREE.Group();
	const keepBody = new THREE.Mesh( new RoundedBoxGeometry( 12, 9, 10, 4, 0.5 ), M.wafer( 0xc8b5ff, 0x9a7ff0 ) );
	keepBody.position.y = 4.5;
	const keepCap = new THREE.Mesh( new RoundedBoxGeometry( 12.6, 0.6, 10.6, 3, 0.28 ), capMat );
	keepCap.position.y = 9.2;
	const rose = new THREE.Mesh( discGeo, M.swirl( 0xff5fa2, 0xffe36e, { arms: 3, spiral: 1.5, glow: 3 } ) );
	rose.rotation.x = Math.PI / 2;
	rose.scale.set( 1.8, 1, 1.8 );
	rose.position.set( 0, 6.2, 5.1 );
	keep.add( keepBody, keepCap, rose );
	for ( let i = 0; i < 18; i ++ ) {

		const u = i / 18;
		const per = 2 * ( 12 + 10 );
		let d = u * per, x, z;
		if ( d < 12 ) [ x, z ] = [ - 6 + d, 5 ];
		else if ( ( d -= 12 ) < 10 ) [ x, z ] = [ 6, 5 - d ];
		else if ( ( d -= 10 ) < 12 ) [ x, z ] = [ 6 - d, - 5 ];
		else [ x, z ] = [ - 6, - 5 + ( d - 12 ) ];
		gumdrops.add( x, 9.45, z, 0.7 );

	}

	const spire = tower( { r: 3.3, h: 13, roofH: 10, flavour: [ 0xff7ab8, 0xfff3d6 ], icing: 0xfff06a, turns: 5 } );
	spire.position.y = 9.4;
	keep.add( spire );
	const crownPop = lollipop( 2.1, 2.5, [ 0xff3b7f, 0xfff06a ] );
	crownPop.position.y = 9.4 + 13 + 9.4;
	keep.add( crownPop );

	for ( const [ x, z, f ] of [ [ - 5.2, 4.2, FLAVOURS[ 1 ] ], [ 5.2, 4.2, FLAVOURS[ 4 ] ], [ - 5.2, - 4.2, FLAVOURS[ 5 ] ], [ 5.2, - 4.2, FLAVOURS[ 3 ] ] ] ) {

		const t = tower( { r: 1.3, h: 5, roofH: 4, flavour: f, icing: 0xffffff, turns: 3 } );
		t.position.set( x, 9.4, z );
		keep.add( t );

	}

	scene.add( shadow( keep ) );
	register( keep, { kind: 'keep', label: 'The Royal Keep — click for fireworks!' } );
	register( crownPop, { kind: 'lollipop', label: 'Crown Lollipop' } );
	updaters.push( ( dt ) => {

		crownPop.userData.spinner.rotation.y += dt * 0.6;
		rose.rotation.y += dt * 0.4;

	} );

	// Lamps along the bridge
	const lamps = [];
	for ( const [ x, z ] of [ [ - 3.2, 19.2 ], [ 3.2, 19.2 ], [ - 3.2, 25 ], [ 3.2, 25 ] ] ) {

		const g = new THREE.Group();
		const pole = new THREE.Mesh( new THREE.CylinderGeometry( 0.14, 0.18, 3.6, 16 ), M.stripes( 0x39d98a, 0xffffff, { cu: 1, cv: 8 } ) );
		pole.position.y = 1.8;
		const c = pick( GUM_COLORS );
		const ball = new THREE.Mesh( sphereGeo, M.lamp( c ) );
		ball.scale.setScalar( 0.5 );
		ball.position.y = 3.9;
		g.add( pole, ball );
		g.position.set( x, 0, z );
		scene.add( shadow( g ) );
		register( g, { kind: 'lamp', label: 'Gumball lamp' } );
		const light = new THREE.PointLight( c, 0, 14, 1.6 );
		light.position.set( x, 4, z );
		scene.add( light );
		lamps.push( light );

	}

	// Candy garden around the moat
	const garden = new THREE.Group();
	scene.add( garden );
	const clear = ( x, z ) => Math.abs( Math.atan2( x, z ) ) > 0.22;
	for ( let i = 0; i < 16; i ++ ) {

		const a = ( i / 16 ) * Math.PI * 2 + rand( - 0.1, 0.1 );
		const r = rand( 26.5, 32.5 );
		const x = Math.sin( a ) * r, z = Math.cos( a ) * r;
		if ( ! clear( x, z ) ) continue;
		const kind = i % 3;
		let o;
		if ( kind === 0 ) {

			o = lollipop( rand( 1.1, 1.9 ), rand( 2.8, 4.8 ) );
			o.userData.spinner.rotation.y = a + rand( - 0.6, 0.6 );
			register( o, { kind: 'lollipop', label: 'Lollipop tree' } );

		} else if ( kind === 1 ) {

			o = iceCream();
			register( o, { kind: 'icecream', label: 'Ice-cream tree' } );

		} else {

			o = candyCane( rand( 2.6, 4 ), Math.random() < 0.5 ? [ 0xff2a4d, 0xffffff ] : [ 0x2bbf6a, 0xffffff ] );
			o.rotation.y = rand( 0, 6.28 );
			register( o, { kind: 'cane', label: 'Candy cane' } );

		}

		o.position.set( x, 0, z );
		garden.add( o );

	}

	for ( let i = 0; i < 70; i ++ ) {

		const a = rand( 0, Math.PI * 2 ), r = rand( 25, 34.5 );
		const x = Math.sin( a ) * r, z = Math.cos( a ) * r;
		if ( ! clear( x, z ) ) continue;
		gumdrops.add( x, 0, z, rand( 0.5, 1.0 ) );

	}

	for ( let i = 0; i < 26; i ++ ) {

		const a = rand( 0, Math.PI * 2 ), r = rand( 25, 34 );
		const x = Math.sin( a ) * r, z = Math.cos( a ) * r;
		if ( ! clear( x, z ) ) continue;
		const k = kiss();
		k.position.set( x, 0, z );
		k.scale.setScalar( rand( 0.6, 1.1 ) );
		garden.add( k );
		register( k, { kind: 'kiss', label: 'Meringue kiss' } );

	}

	// Orbiting donuts
	const donuts = [];
	const donutGeo = new THREE.TorusGeometry( 2.2, 1.05, 32, 64 );
	[ 0xff8fc2, 0x6b3a2a, 0x8fe3ff, 0xfff06a, 0xc6a8ff, 0xffffff ].forEach( ( icing, i ) => {

		const d = new THREE.Mesh( donutGeo, M.donut( icing ) );
		d.castShadow = true;
		const holder = new THREE.Group();
		holder.add( d );
		scene.add( holder );
		register( holder, { kind: 'donut', label: 'Flying donut' } );
		donuts.push( { holder, mesh: d, a: ( i / 6 ) * Math.PI * 2, r: rand( 44, 52 ), y: rand( 12, 24 ), s: rand( 0.08, 0.13 ), tilt: rand( - 0.6, 0.6 ) } );

	} );
	updaters.push( ( dt, t ) => {

		for ( const d of donuts ) {

			d.a += d.s * dt;
			d.holder.position.set( Math.sin( d.a ) * d.r, d.y + Math.sin( t * 0.8 + d.a * 3 ) * 1.5, Math.cos( d.a ) * d.r );
			d.mesh.rotation.set( 1.1 + d.tilt, t * 0.3 + d.a, 0 );

		}

	} );

	// Cotton-candy clouds
	const clouds = [];
	const cloudCols = [ 0xffc2e2, 0xc9e6ff, 0xffe0f0, 0xe3d4ff, 0xfff0f7 ];
	for ( let i = 0; i < 18; i ++ ) {

		const c = new THREE.Mesh( cloudGeo(), M.cloud( pick( cloudCols ) ) );
		const a = rand( 0, Math.PI * 2 ), r = rand( 55, 130 );
		const y = i < 7 ? rand( - 38, - 16 ) : rand( - 5, 32 );
		c.position.set( Math.sin( a ) * r, y, Math.cos( a ) * r );
		c.scale.setScalar( rand( 1.1, 2.4 ) );
		c.rotation.y = rand( 0, 6 );
		scene.add( c );
		register( c, { kind: 'cloud', label: 'Cotton-candy cloud' } );
		clouds.push( { mesh: c, a, r, y, s: rand( 0.004, 0.012 ) } );

	}

	updaters.push( ( dt, t ) => {

		for ( const c of clouds ) {

			c.a += c.s * dt;
			c.mesh.position.x = Math.sin( c.a ) * c.r;
			c.mesh.position.z = Math.cos( c.a ) * c.r;
			c.mesh.position.y = c.y + Math.sin( t * 0.3 + c.r ) * 1.2;

		}

	} );

	return { updaters, towers, keep, lamps, gumdrops, garden, gate, cake };

}

function heartShape() {

	const s = new THREE.Shape();
	s.moveTo( 0, 5 );
	s.bezierCurveTo( 0, 5, - 1, 0, - 5, 0 );
	s.bezierCurveTo( - 11, 0, - 11, 7, - 11, 7 );
	s.bezierCurveTo( - 11, 11, - 7, 15.4, 0, 19 );
	s.bezierCurveTo( 7, 15.4, 11, 11, 11, 7 );
	s.bezierCurveTo( 11, 7, 11, 0, 5, 0 );
	s.bezierCurveTo( 1, 0, 0, 5, 0, 5 );
	return s;

}
