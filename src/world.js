import * as THREE from 'three/webgpu';
import {
	vec3, color, mix, smoothstep, normalize, positionLocal, length, dot, pow, max,
	floor, hash, sin, time, step, float, TWO_PI, cos
} from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as M from './materials.js';
import { night } from './materials.js';

export const CAKE_R = 50;
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

function softServeGeo( R, H, turns = 4, amp = 0.13, n = 70, segments = 96 ) {

	const pts = [];
	for ( let i = 0; i <= n; i ++ ) {

		const t = i / n;
		pts.push( new THREE.Vector2( Math.max( R * Math.pow( 1 - t, 0.8 ), 0.0001 ), t * H ) );

	}

	const geo = new THREE.LatheGeometry( pts, segments );
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
	return new THREE.LatheGeometry( curve.getPoints( 12 ), 20 );

} )();

const kissGeo = softServeGeo( 0.7, 1.3, 3, 0.18, 18, 28 ); // low-poly: instanced hundreds of times
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

// Bakes every mergeable mesh under `root` into one mesh per material, so a
// tower with dozens of windows costs a handful of draw calls.
function mergeStatic( root ) {

	root.updateMatrixWorld( true );
	const inv = root.matrixWorld.clone().invert();
	const buckets = new Map();
	const merged = [];
	root.traverse( ( o ) => {

		if ( ! o.isMesh || o.isInstancedMesh || ! o.material.userData.merge ) return;
		const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
		for ( const k of Object.keys( g.attributes ) ) if ( ! [ 'position', 'normal', 'uv' ].includes( k ) ) g.deleteAttribute( k );
		g.clearGroups();
		g.applyMatrix4( new THREE.Matrix4().multiplyMatrices( inv, o.matrixWorld ) );
		if ( ! buckets.has( o.material ) ) buckets.set( o.material, [] );
		buckets.get( o.material ).push( g );
		merged.push( o );

	} );

	for ( const o of merged ) o.removeFromParent();
	for ( const [ mat, geos ] of buckets ) {

		const m = new THREE.Mesh( mergeGeometries( geos ), mat );
		m.castShadow = m.receiveShadow = true;
		root.add( m );

	}

	return root;

}

const flagGeo = new THREE.PlaneGeometry( 3.2, 1.6, 20, 2 ).translate( 1.6, 0, 0 );

function pennant( y, flavour ) {

	const g = new THREE.Group();
	const pole = new THREE.Mesh( stickGeo, M.candyGloss( 0xffffff, { roughness: 0.35 } ) );
	pole.scale.set( 0.8, 4, 0.8 );
	pole.position.y = y + 2;
	const knob = new THREE.Mesh( sphereGeo, M.candyGloss( 0xffd23f, { roughness: 0.15, metalness: 0.3 } ) );
	knob.scale.setScalar( 0.22 );
	knob.position.y = y + 4.05;
	const f = new THREE.Mesh( flagGeo, M.flag( flavour[ 0 ], flavour[ 1 ] ) );
	f.position.set( 0.05, y + 3.2, 0 );
	g.add( pole, knob, f );
	return g;

}

function tower( { r, h, roofH, flavour, icing, turns = 4, top = 'cherry' } ) {

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
	g.add( body, foot, crown, roof );

	// Rows of arched windows, staggered row to row.
	const perRow = r > 2.4 ? 6 : 4;
	const ws = r > 3 ? 1.3 : 1;
	let row = 0;
	for ( let y = 2.6; y < h - 2.2; y += 3.8, row ++ ) {

		for ( let i = 0; i < perRow; i ++ ) {

			const a = ( i / perRow ) * Math.PI * 2 + row * Math.PI / perRow;
			const w = new THREE.Mesh( windowGeo, M.windowGlow() );
			w.scale.setScalar( ws );
			w.position.set( Math.sin( a ) * ( r - 0.05 ), y, Math.cos( a ) * ( r - 0.05 ) );
			w.rotation.y = a;
			g.add( w );

		}

	}

	const tipY = h + roofH;
	if ( top === 'cherry' ) {

		const c = cherry();
		c.position.y = tipY - 0.35;
		g.add( c );

	} else if ( top === 'flag' ) {

		g.add( pennant( tipY - 0.4, flavour ) );

	}

	g.userData.top = new THREE.Vector3( 0, tipY + ( top === 'flag' ? 4 : 1 ), 0 );
	return mergeStatic( shadow( g ) );

}

function bearGeo() {

	const parts = [];
	const S = ( r, x, y, z, sx = 1, sy = 1, sz = 1 ) => {

		const g = new THREE.SphereGeometry( r, 20, 14 );
		g.scale( sx, sy, sz );
		g.translate( x, y, z );
		parts.push( g );

	};

	S( 0.8, 0, 1.15, 0, 1, 1.15, 0.85 ); // body
	S( 0.62, 0, 2.3, 0, 1.05, 0.95, 0.95 ); // head
	S( 0.22, - 0.45, 2.8, 0 ); S( 0.22, 0.45, 2.8, 0 ); // ears
	S( 0.24, 0, 2.2, 0.55, 1.1, 0.8, 0.9 ); // snout
	S( 0.26, - 0.78, 1.45, 0.1, 0.9, 1.3, 0.9 ); S( 0.26, 0.78, 1.45, 0.1, 0.9, 1.3, 0.9 ); // arms
	S( 0.32, - 0.42, 0.3, 0.1, 1, 0.9, 1.2 ); S( 0.32, 0.42, 0.3, 0.1, 1, 0.9, 1.2 ); // feet
	return mergeGeometries( parts );

}

const BEAR_GEO = bearGeo();
const EYES_GEO = mergeGeometries( [ - 0.22, 0.22 ].map( ( x ) => new THREE.SphereGeometry( 0.07, 10, 8 ).translate( x, 2.45, 0.55 ) ) );
const BEAR_COLS = [ 0xff2d55, 0xff8a1f, 0xffd21f, 0x3ddc84, 0xa66bff, 0x2ec5ff ];

function gummyBear( c ) {

	const g = new THREE.Group();
	const inner = new THREE.Group();
	inner.add( new THREE.Mesh( BEAR_GEO, M.gummy( c ) ), new THREE.Mesh( EYES_GEO, M.candyGloss( 0x2a0f1a, { roughness: 0.1 } ) ) );
	g.add( inner );
	g.userData.inner = inner;
	g.userData.top = new THREE.Vector3( 0, 3, 0 );
	return shadow( g );

}

function fountain() {

	const g = new THREE.Group();
	const add = ( geo, mat, y, rotX = 0 ) => {

		const m = new THREE.Mesh( geo, mat );
		m.position.y = y;
		m.rotation.x = rotX;
		g.add( m );
		return m;

	};

	const pink = M.candyGloss( 0xff9cc8, { roughness: 0.2 } );
	const choc = M.chocolate();
	add( new THREE.CylinderGeometry( 3, 3.2, 1, 48 ), pink, 0.5 );
	add( new THREE.TorusGeometry( 3, 0.22, 10, 48 ), M.frosting( 0xfffafc ), 1, - Math.PI / 2 );
	add( new THREE.RingGeometry( 0.01, 2.85, 64, 8 ), choc, 0.96, - Math.PI / 2 );
	add( new THREE.CylinderGeometry( 0.35, 0.45, 3.4, 16 ), M.stripes( 0xff5fa2, 0xffffff, { cu: 1, cv: 5 } ), 1.7 );
	add( new THREE.CylinderGeometry( 1.7, 0.5, 0.6, 40 ), pink, 2.4 );
	add( new THREE.RingGeometry( 0.01, 1.55, 48, 6 ), choc, 2.72, - Math.PI / 2 );
	add( new THREE.CylinderGeometry( 1.72, 1.95, 1.7, 40, 1, true ), M.chocoFlow(), 1.85 );
	add( new THREE.CylinderGeometry( 1.0, 0.35, 0.45, 32 ), pink, 3.8 );
	add( new THREE.RingGeometry( 0.01, 0.9, 32, 4 ), choc, 4.03, - Math.PI / 2 );
	add( new THREE.CylinderGeometry( 1.02, 1.2, 1.3, 32, 1, true ), M.chocoFlow(), 3.4 );
	const c = cherry();
	c.position.y = 4.1;
	g.add( c );
	g.userData.top = new THREE.Vector3( 0, 5, 0 );
	return shadow( g );

}

function cloudGeo() {

	const parts = [];
	const n = 5 + Math.floor( Math.random() * 4 );
	for ( let i = 0; i < n; i ++ ) {

		const s = new THREE.IcosahedronGeometry( rand( 2.2, 4.2 ), 3 );
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
	mesh.position.set( - 60, - 90, - 560 );
	mesh.rotation.y = 0.2;
	mesh.scale.setScalar( 1.5 );
	return mesh;

}

// ---------- build the whole world ----------

const R1 = 24; // outer wall: octagon vertex radius
const WALL_D = R1 * Math.cos( Math.PI / 8 ); // distance to each wall's centre line
const SIDE_L = 2 * R1 * Math.sin( Math.PI / 8 );
const WH = 7, WT = 2;
const TERRACE_R = 13, TERRACE_TOP = 7.8;
const MOAT_IN = 29, MOAT_OUT = 33;
const SPIRE_BASE = TERRACE_TOP + 10.5;
export const HEART_Y = SPIRE_BASE + 16 + 12 + 6.5;

const radial = ( phi ) => new THREE.Vector3( Math.sin( phi ), 0, Math.cos( phi ) );
const tangent = ( phi ) => new THREE.Vector3( Math.cos( phi ), 0, - Math.sin( phi ) );

export function buildWorld( scene, register ) {

	const updaters = [];
	const build = []; // [ object, delay ]: the castle assembles itself during the intro
	const towers = [];
	const rocketBases = [];
	const bears = [];
	scene.add( sky(), rainbow() );

	// ----- cake island -----
	const cake = new THREE.Group();
	const sponge = new THREE.Mesh( new THREE.CylinderGeometry( CAKE_R, CAKE_R * 0.97, 10, 160, 1 ), M.sponge() );
	sponge.position.y = - 5.6;
	const jam = new THREE.Mesh( new THREE.CylinderGeometry( CAKE_R + 0.15, CAKE_R + 0.15, 1.2, 160, 1, true ), M.frosting( 0xff4f8b ) );
	jam.position.y = - 5.7;
	const top = new THREE.Mesh( new THREE.CylinderGeometry( CAKE_R + 0.6, CAKE_R + 0.6, 1.3, 160, 1 ), M.frosting( 0xffb8d9, { sprinkleScale: 210, density: 0.6 } ) );
	top.position.y = - 0.65;
	const plate = new THREE.Mesh( new THREE.CylinderGeometry( CAKE_R + 5, CAKE_R + 4, 0.9, 160 ), M.candyGloss( 0xfff3fa, { roughness: 0.15 } ) );
	plate.position.y = - 11;
	cake.add( sponge, jam, top, plate );

	const mtx = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const drips = new THREE.InstancedMesh( new THREE.CapsuleGeometry( 0.7, 1, 6, 12 ), M.frosting( 0xffb8d9 ), 130 );
	const piped = new THREE.InstancedMesh( kissGeo, M.frosting( 0xfffafc ), 160 );
	for ( let i = 0; i < 130; i ++ ) {

		const a = ( i / 130 ) * Math.PI * 2 + rand( - 0.015, 0.015 );
		const len = rand( 0.4, 3.4 );
		mtx.compose( new THREE.Vector3( Math.sin( a ) * ( CAKE_R + 0.35 ), - 1.2 - len * 0.6, Math.cos( a ) * ( CAKE_R + 0.35 ) ), q, new THREE.Vector3( 1, len, 0.6 ) );
		drips.setMatrixAt( i, mtx );

	}

	for ( let i = 0; i < 160; i ++ ) {

		const a = ( i / 160 ) * Math.PI * 2;
		mtx.compose( new THREE.Vector3( Math.sin( a ) * ( CAKE_R - 0.3 ), - 0.05, Math.cos( a ) * ( CAKE_R - 0.3 ) ), q.setFromEuler( new THREE.Euler( 0, a, 0 ) ), new THREE.Vector3( 1.2, 0.9, 1.2 ) );
		piped.setMatrixAt( i, mtx );

	}

	cake.add( drips, piped );
	scene.add( shadow( cake ) );
	register( top, { kind: 'ground', label: 'Frosting meadow: click to plant candy' } );
	register( sponge, { kind: 'cake', label: 'Vanilla sponge' } );

	// ----- chocolate moat, wafer bridge and path -----
	const moat = new THREE.Mesh( new THREE.RingGeometry( MOAT_IN, MOAT_OUT, 220, 6 ), M.chocolate() );
	moat.rotation.x = - Math.PI / 2;
	moat.position.y = 0.06;
	moat.receiveShadow = true;
	scene.add( moat );
	register( moat, { kind: 'river', label: 'Chocolate river' } );

	for ( const r of [ MOAT_IN, MOAT_OUT ] ) {

		const bank = new THREE.Mesh( new THREE.TorusGeometry( r, 0.4, 10, 220 ), M.frosting( 0xfff6fb ) );
		bank.rotation.x = - Math.PI / 2;
		scene.add( shadow( bank ) );

	}

	const bridge = new THREE.Mesh( new RoundedBoxGeometry( 6, 0.8, 7.5, 3, 0.28 ), M.wafer( 0xf2c078, 0xc98a45 ) );
	bridge.position.set( 0, 0.4, ( MOAT_IN + MOAT_OUT ) / 2 );
	const path = new THREE.Mesh( new RoundedBoxGeometry( 5, 0.3, 6, 2, 0.12 ), M.wafer( 0xf2c078, 0xc98a45 ) );
	path.position.set( 0, 0.1, 26 );
	scene.add( shadow( bridge ), shadow( path ) );

	const gumdrops = new Gumdrops( 900 );
	scene.add( gumdrops.mesh );
	register( gumdrops.mesh, { kind: 'gumdrop', label: 'Sugared gumdrop' } );

	// ----- outer curtain wall: an octagon with the gate facing +z -----
	const walls = new THREE.Group();
	const wallMat = M.wafer( 0xf9a8cb, 0xe46fa3 );
	const capMat = M.frosting( 0xfffafc );
	const wallDrips = [];

	const segment = ( phi, o0, o1 ) => {

		const u = radial( phi ), t = tangent( phi );
		const len = o1 - o0, oc = ( o0 + o1 ) / 2;
		const c = u.clone().multiplyScalar( WALL_D ).addScaledVector( t, oc );
		const w = new THREE.Mesh( new RoundedBoxGeometry( len, WH, WT, 3, 0.3 ), wallMat );
		w.position.set( c.x, WH / 2, c.z );
		w.rotation.y = phi;
		const cap = new THREE.Mesh( new RoundedBoxGeometry( len + 0.2, 0.5, WT + 0.5, 3, 0.22 ), capMat );
		cap.position.set( c.x, WH + 0.15, c.z );
		cap.rotation.y = phi;
		walls.add( w, cap );

		// Gumdrop crenellations along the outer edge of the wall walk
		const n = Math.floor( len / 1.3 );
		for ( let i = 0; i < n; i ++ ) {

			const p = u.clone().multiplyScalar( WALL_D + 0.55 ).addScaledVector( t, oc + ( i - ( n - 1 ) / 2 ) * ( len / n ) );
			gumdrops.add( p.x, WH + 0.38, p.z, 0.6 );

		}

		// Icing dripping down both faces
		const rot = new THREE.Quaternion().setFromEuler( new THREE.Euler( 0, phi, 0 ) );
		for ( let o = o0 + 0.4; o < o1 - 0.3; o += 0.85 ) {

			for ( const side of [ - 1, 1 ] ) {

				const l = rand( 0.5, 2.2 );
				const p = u.clone().multiplyScalar( WALL_D + side * ( WT / 2 + 0.12 ) ).addScaledVector( t, o + rand( - 0.15, 0.15 ) );
				wallDrips.push( new THREE.Matrix4().compose( new THREE.Vector3( p.x, WH - l * 0.45, p.z ), rot, new THREE.Vector3( 1, l, 0.7 ) ) );

			}

		}

		// Candle-lit windows on the outside
		if ( len > 8 ) {

			for ( const o of [ oc - len * 0.25, oc + len * 0.25 ] ) {

				const p = u.clone().multiplyScalar( WALL_D + WT / 2 - 0.05 ).addScaledVector( t, o );
				const win = new THREE.Mesh( windowGeo, M.windowGlow() );
				win.position.set( p.x, 2.6, p.z );
				win.rotation.y = phi;
				win.scale.setScalar( 1.2 );
				walls.add( win );

			}

		}

	};

	const half = SIDE_L / 2;
	for ( let k = 1; k < 8; k ++ ) segment( k * Math.PI / 4, - half + 1.2, half - 1.2 );
	segment( 0, - half + 1.2, - 4.8 );
	segment( 0, 4.8, half - 1.2 );

	// Gatehouse lintel with a glowing swirl emblem
	const lintel = new THREE.Mesh( new RoundedBoxGeometry( 9.6, 3.2, WT + 0.4, 3, 0.3 ), wallMat );
	lintel.position.set( 0, WH + 1.6, WALL_D );
	const lintelCap = new THREE.Mesh( new RoundedBoxGeometry( 9.9, 0.5, WT + 0.9, 3, 0.22 ), capMat );
	lintelCap.position.set( 0, WH + 3.35, WALL_D );
	walls.add( lintel, lintelCap );
	for ( let i = 0; i < 6; i ++ ) gumdrops.add( - 3.75 + i * 1.5, WH + 3.6, WALL_D + 0.3, 0.7 );

	const dripMesh = new THREE.InstancedMesh( new THREE.CapsuleGeometry( 0.28, 0.6, 4, 8 ), capMat, wallDrips.length );
	wallDrips.forEach( ( m, i ) => dripMesh.setMatrixAt( i, m ) );
	walls.add( dripMesh );
	mergeStatic( shadow( walls ) );

	const emblem = new THREE.Mesh( discGeo, M.swirl( 0xff5fa2, 0xffe36e, { arms: 3, spiral: 1.5, glow: 3 } ) );
	emblem.rotation.x = Math.PI / 2;
	emblem.scale.set( 1.3, 1, 1.3 );
	emblem.position.set( 0, WH + 1.6, WALL_D + 1.3 );
	walls.add( shadow( emblem ) );
	scene.add( walls );
	register( walls, { kind: 'wall', label: 'Strawberry wafer walls' } );
	build.push( [ walls, 0.5 ] );
	updaters.push( ( dt ) => emblem.rotation.y += dt * 0.5 );

	// ----- the eight outer towers, plus two gatehouse towers -----
	const TOWER_NAMES = [ 'Strawberry', 'Mint', 'Grape', 'Lemon', 'Peach', 'Blueberry', 'Bubblegum', 'Sherbet' ];
	const ICINGS = [ 0xffd1ec, 0x8fe3ff, 0xfff06a, 0xc6a8ff, 0xff8fc2, 0xffffff ];
	for ( let k = 0; k < 8; k ++ ) {

		const a = ( k + 0.5 ) * Math.PI / 4;
		const t = tower( { r: 3, h: 15, roofH: 8, flavour: FLAVOURS[ k % 6 ], icing: ICINGS[ k % 6 ], top: 'flag', turns: 4 } );
		t.position.set( Math.sin( a ) * R1, 0, Math.cos( a ) * R1 );
		scene.add( t );
		register( t, { kind: 'tower', label: `${TOWER_NAMES[ k ]} Tower` } );
		towers.push( t );
		rocketBases.push( t.position.clone().setY( 25 ) );
		build.push( [ t, 0.2 + k * 0.12 ] );

	}

	for ( const x of [ - 4.6, 4.6 ] ) {

		const t = tower( { r: 2, h: 12.5, roofH: 6, flavour: [ 0xff3b7f, 0xffffff ], icing: 0xfff06a, top: 'flag', turns: 3 } );
		t.position.set( x, 0, WALL_D );
		scene.add( t );
		register( t, { kind: 'tower', label: 'Gatehouse Tower' } );
		towers.push( t );
		build.push( [ t, 1.2 ] );

	}

	// ----- gingerbread gate with a candy-cane arch -----
	const gate = new THREE.Group();
	gate.position.set( 0, 0, WALL_D + WT / 2 + 0.05 );
	const doorPivot = new THREE.Group();
	doorPivot.position.x = - 2.4;
	const door = new THREE.Mesh( new THREE.ExtrudeGeometry( archShape( 4.8, 4.9 ), { depth: 0.35, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.1 } ), M.candyGloss( 0x9b5a2c, { roughness: 0.6, clearcoat: 0.2 } ) );
	door.position.x = 2.4;
	const knob = new THREE.Mesh( sphereGeo, M.lamp( 0xff3b7f ) );
	knob.scale.setScalar( 0.28 );
	knob.position.set( 4.1, 2.3, 0.55 );
	const heartDeco = new THREE.Mesh( new THREE.ExtrudeGeometry( heartShape(), { depth: 0.15, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 } ), M.candyGloss( 0xff4f8b ) );
	heartDeco.scale.setScalar( 0.12 );
	heartDeco.position.set( 2.4, 3.3, 0.45 );
	heartDeco.rotation.z = Math.PI;
	doorPivot.add( door, knob, heartDeco );
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
	build.push( [ gate, 1.3 ] );

	// ----- the raised cake terrace -----
	const terrace = new THREE.Group();
	const tSide = new THREE.Mesh( new THREE.CylinderGeometry( TERRACE_R, TERRACE_R + 0.3, TERRACE_TOP - 0.4, 96, 1 ), M.stripes( 0xffb8d9, 0xfff4f8, { cu: 48, cv: 0, width: 0.5 } ) );
	tSide.position.y = ( TERRACE_TOP - 0.4 ) / 2;
	const tCap = new THREE.Mesh( new THREE.CylinderGeometry( TERRACE_R + 0.4, TERRACE_R + 0.4, 0.8, 96, 1 ), M.frosting( 0xc8b5ff, { sprinkleScale: 70, density: 0.55 } ) );
	tCap.position.y = TERRACE_TOP - 0.4;
	const tBand = new THREE.Mesh( new THREE.TorusGeometry( TERRACE_R + 0.35, 0.35, 10, 96 ), M.frosting( 0xff4f8b ) );
	tBand.rotation.x = - Math.PI / 2;
	tBand.position.y = 0.3;
	terrace.add( tSide, tCap, tBand );
	const tDrips = new THREE.InstancedMesh( new THREE.CapsuleGeometry( 0.45, 0.8, 4, 10 ), M.frosting( 0xc8b5ff ), 70 );
	const tPiped = new THREE.InstancedMesh( kissGeo, M.frosting( 0xfffafc ), 90 );
	for ( let i = 0; i < 70; i ++ ) {

		const a = ( i / 70 ) * Math.PI * 2;
		const l = rand( 0.5, 2.6 );
		tDrips.setMatrixAt( i, mtx.compose( new THREE.Vector3( Math.sin( a ) * ( TERRACE_R + 0.42 ), TERRACE_TOP - 0.7 - l * 0.5, Math.cos( a ) * ( TERRACE_R + 0.42 ) ), q.identity(), new THREE.Vector3( 1, l, 0.6 ) ) );

	}

	for ( let i = 0; i < 90; i ++ ) {

		const a = ( i / 90 ) * Math.PI * 2;
		tPiped.setMatrixAt( i, mtx.compose( new THREE.Vector3( Math.sin( a ) * ( TERRACE_R + 0.05 ), TERRACE_TOP - 0.05, Math.cos( a ) * ( TERRACE_R + 0.05 ) ), q.setFromEuler( new THREE.Euler( 0, a, 0 ) ), new THREE.Vector3( 0.8, 0.7, 0.8 ) ) );

	}

	terrace.add( tDrips, tPiped );
	mergeStatic( shadow( terrace ) );
	scene.add( terrace );
	register( terrace, { kind: 'cake', label: 'Royal cake terrace' } );
	build.push( [ terrace, 1.5 ] );

	// Grand staircase of candy bars
	const stairs = new THREE.Group();
	const STEPS = 8;
	for ( let i = 0; i < STEPS; i ++ ) {

		const y = TERRACE_TOP * ( 1 - i / STEPS );
		const s = new THREE.Mesh( new RoundedBoxGeometry( 5.2, y, 1.1, 2, 0.12 ), M.candyGloss( i % 2 ? 0xffffff : 0xff7ab8, { roughness: 0.25 } ) );
		s.position.set( 0, y / 2, 12.95 + i * 1.05 );
		stairs.add( s );

	}

	for ( const x of [ - 3.1, 3.1 ] ) {

		const post = candyCane( 3, [ 0xff2a4d, 0xffffff ] );
		post.position.set( x, 0, 20.3 );
		post.rotation.y = x < 0 ? 0 : Math.PI;
		stairs.add( post );

	}

	mergeStatic( shadow( stairs ) );
	scene.add( stairs );
	register( stairs, { kind: 'cake', label: 'Candy staircase' } );
	build.push( [ stairs, 1.7 ] );

	// Six towers ringing the terrace
	for ( let k = 0; k < 6; k ++ ) {

		const a = ( 30 + k * 60 ) * Math.PI / 180;
		const t = tower( { r: 1.8, h: 8, roofH: 5, flavour: FLAVOURS[ ( k + 3 ) % 6 ], icing: ICINGS[ ( k + 2 ) % 6 ], turns: 3 } );
		t.position.set( Math.sin( a ) * 11, TERRACE_TOP, Math.cos( a ) * 11 );
		scene.add( t );
		register( t, { kind: 'tower', label: 'Terrace Turret' } );
		towers.push( t );
		build.push( [ t, 1.8 + k * 0.1 ] );

	}

	// ----- the royal keep and the great spire -----
	const keep = new THREE.Group();
	keep.position.y = TERRACE_TOP;
	const keepBody = new THREE.Group();
	const kWafer = M.wafer( 0xc8b5ff, 0x9a7ff0 );
	const kb = new THREE.Mesh( new RoundedBoxGeometry( 12, 10, 10, 4, 0.5 ), kWafer );
	kb.position.y = 5;
	const kc = new THREE.Mesh( new RoundedBoxGeometry( 12.6, 0.6, 10.6, 3, 0.28 ), capMat );
	kc.position.y = 10.2;
	const kDoor = new THREE.Mesh( new THREE.ExtrudeGeometry( archShape( 3, 4.4 ), { depth: 0.3, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.08 } ), M.candyGloss( 0x9b5a2c, { roughness: 0.6, clearcoat: 0.2 } ) );
	kDoor.position.set( 0, 0, 4.95 );
	keepBody.add( kb, kc, kDoor );
	for ( const x of [ - 2.6, 2.6 ] ) {

		const col = new THREE.Mesh( new THREE.CylinderGeometry( 0.35, 0.35, 8, 16 ), M.stripes( 0xff2a4d, 0xffffff, { cu: 1, cv: 6 } ) );
		col.position.set( x, 4, 5.4 );
		const capital = new THREE.Mesh( sphereGeo, M.candyGloss( 0xffffff, { roughness: 0.2 } ) );
		capital.scale.setScalar( 0.5 );
		capital.position.set( x, 8.2, 5.4 );
		keepBody.add( col, capital );

	}

	for ( const [ x, z, ry ] of [ [ 6, - 2.5, Math.PI / 2 ], [ 6, 2.5, Math.PI / 2 ], [ - 6, - 2.5, - Math.PI / 2 ], [ - 6, 2.5, - Math.PI / 2 ], [ - 3, - 5, Math.PI ], [ 3, - 5, Math.PI ], [ 0, - 5, Math.PI ] ] ) {

		for ( const y of [ 2.5, 6.3 ] ) {

			const w = new THREE.Mesh( windowGeo, M.windowGlow() );
			w.position.set( x, y, z );
			w.rotation.y = ry;
			w.scale.setScalar( 1.3 );
			keepBody.add( w );

		}

	}

	keep.add( mergeStatic( shadow( keepBody ) ) );

	const rose = new THREE.Mesh( discGeo, M.swirl( 0xff5fa2, 0xffe36e, { arms: 3, spiral: 1.5, glow: 3 } ) );
	rose.rotation.x = Math.PI / 2;
	rose.scale.set( 1.6, 1, 1.6 );
	rose.position.set( 0, 6.4, 5.1 );
	keep.add( rose );
	updaters.push( ( dt ) => rose.rotation.y += dt * 0.4 );

	for ( const [ x, z ] of [ [ - 5.2, 4.2 ], [ 5.2, 4.2 ], [ - 5.2, - 4.2 ], [ 5.2, - 4.2 ] ] ) {

		const t = tower( { r: 1.3, h: 5, roofH: 4, flavour: FLAVOURS[ Math.floor( rand( 0, 6 ) ) ], icing: 0xffffff, turns: 3 } );
		t.position.set( x, 10.5, z );
		keep.add( t );

	}

	for ( let x = - 3.4; x <= 3.4; x += 1.7 ) for ( const z of [ - 5, 5 ] ) gumdrops.add( x, SPIRE_BASE, z, 0.6 );
	for ( let z = - 2.4; z <= 2.4; z += 1.6 ) for ( const x of [ - 6, 6 ] ) gumdrops.add( x, SPIRE_BASE, z, 0.6 );

	const spire = tower( { r: 3.6, h: 16, roofH: 12, flavour: [ 0xff7ab8, 0xfff3d6 ], icing: 0xfff06a, turns: 6, top: 'none' } );
	spire.position.y = 10.5;
	const balcony = new THREE.Group();
	const floor = new THREE.Mesh( new THREE.CylinderGeometry( 4.9, 4.4, 0.5, 48 ), M.frosting( 0xff9cc8 ) );
	const rail = new THREE.Mesh( new THREE.TorusGeometry( 4.7, 0.1, 8, 64 ), M.candyGloss( 0xff5fa2 ) );
	rail.rotation.x = - Math.PI / 2;
	rail.position.y = 1.2;
	balcony.add( floor, rail );
	for ( let i = 0; i < 24; i ++ ) {

		const a = ( i / 24 ) * Math.PI * 2;
		const post = new THREE.Mesh( stickGeo, M.candyGloss( 0xffffff, { roughness: 0.35 } ) );
		post.scale.y = 1.1;
		post.position.set( Math.sin( a ) * 4.7, 0.7, Math.cos( a ) * 4.7 );
		balcony.add( post );

	}

	balcony.position.y = 8;
	spire.add( mergeStatic( shadow( balcony ) ) );
	keep.add( spire );
	scene.add( keep );
	register( keep, { kind: 'keep', label: 'The Royal Keep: click for fireworks!' } );
	build.push( [ keep, 2.3 ], [ spire, 2.8 ] );

	// ----- the crystal sugar heart, floating above it all -----
	const heart = new THREE.Group();
	heart.position.y = HEART_Y;
	const heartGeo = new THREE.ExtrudeGeometry( heartShape(), { depth: 5, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 6, curveSegments: 32 } );
	heartGeo.center();
	const gem = new THREE.Mesh( heartGeo, M.crystal() );
	gem.scale.setScalar( 0.26 );
	gem.rotation.z = Math.PI;
	gem.castShadow = true;
	const spinner = new THREE.Group();
	spinner.add( gem );
	heart.add( spinner );

	const ringCols = [ 0xff3b7f, 0x39d98a, 0xffb627, 0x8f6bff, 0x2ec5ff, 0xffffff ];
	const rings = [ [ 6, 0.5, 0 ], [ 7.6, - 0.6, 1.2 ], [ 9.2, 0.25, 2.2 ] ].map( ( [ r, tilt, yaw ], j ) => {

		const g = new THREE.Group();
		g.rotation.set( tilt, yaw, 0 );
		const n = 14 + j * 4;
		const im = new THREE.InstancedMesh( sphereGeo, M.candyGloss( 0xffffff, { roughness: 0.12 } ), n );
		const c = new THREE.Color();
		for ( let i = 0; i < n; i ++ ) {

			const a = ( i / n ) * Math.PI * 2;
			im.setMatrixAt( i, mtx.compose( new THREE.Vector3( Math.cos( a ) * r, 0, Math.sin( a ) * r ), q.identity(), new THREE.Vector3( 0.38, 0.38, 0.38 ) ) );
			im.setColorAt( i, c.set( ringCols[ ( i + j ) % ringCols.length ] ) );

		}

		g.add( im );
		heart.add( g );
		return g;

	} );

	const beamMesh = new THREE.Mesh( new THREE.CylinderGeometry( 1.5, 4, 220, 32, 1, true ), M.beam() );
	beamMesh.position.y = 110;
	beamMesh.raycast = () => {}; // clicks pass through the light beam
	heart.add( beamMesh );
	const heartLight = new THREE.PointLight( 0xff5fa8, 0, 90, 1.4 );
	heart.add( heartLight );
	scene.add( heart );
	register( heart, { kind: 'heart', label: 'The Crystal Sugar Heart ✨' } );
	build.push( [ heart, 3.6 ] );
	heart.userData.spinner = spinner;
	heart.userData.top = new THREE.Vector3();
	updaters.push( ( dt, t ) => {

		spinner.rotation.y += dt * 0.7;
		spinner.position.y = Math.sin( t * 1.3 ) * 0.6;
		rings.forEach( ( g, j ) => g.children[ 0 ].rotation.y += dt * ( 0.5 - j * 0.35 ) );

	} );

	// ----- festival lights strung from the spire to every outer tower -----
	const lights = new THREE.Group();
	const bulbs = new Map();
	const strandMat = M.stripes( 0xff2a4d, 0xffffff, { cu: 1, cv: 60, width: 0.5 } );
	for ( let k = 0; k < 8; k ++ ) {

		const a = ( k + 0.5 ) * Math.PI / 4;
		const from = radial( a ).multiplyScalar( 3.9 ).setY( SPIRE_BASE + 2.5 );
		const to = radial( a ).multiplyScalar( R1 - 3.4 ).setY( 15.4 );
		const at = ( t ) => from.clone().lerp( to, t ).setY( THREE.MathUtils.lerp( from.y, to.y, t ) - 2.5 * 4 * t * ( 1 - t ) );
		const pts = [];
		for ( let i = 0; i <= 12; i ++ ) pts.push( at( i / 12 ) );
		lights.add( new THREE.Mesh( new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts ), 48, 0.07, 6 ), strandMat ) );
		for ( let i = 1; i < 16; i ++ ) {

			const c = GUM_COLORS[ ( i + k ) % GUM_COLORS.length ];
			if ( ! bulbs.has( c ) ) bulbs.set( c, [] );
			bulbs.get( c ).push( at( i / 16 ).add( new THREE.Vector3( 0, - 0.25, 0 ) ) );

		}

	}

	mergeStatic( lights );
	const bulbGeo = new THREE.SphereGeometry( 0.26, 12, 8 );
	for ( const [ c, list ] of bulbs ) {

		const im = new THREE.InstancedMesh( bulbGeo, M.lamp( c ), list.length );
		list.forEach( ( p, i ) => im.setMatrixAt( i, mtx.makeTranslation( p ) ) );
		lights.add( im );

	}

	scene.add( lights );
	build.push( [ lights, 3.3 ] );

	// ----- courtyard: chocolate fountains and a little garden -----
	for ( const x of [ - 17.4, 17.4 ] ) {

		const f = fountain();
		f.position.set( x, 0, 0 );
		f.scale.setScalar( 1.1 );
		scene.add( f );
		register( f, { kind: 'fountain', label: 'Chocolate fountain' } );
		build.push( [ f, 2.0 ] );

	}

	const garden = new THREE.Group();
	scene.add( garden );
	const inCourtyard = ( x, z ) => {

		const r = Math.hypot( x, z );
		return r > TERRACE_R + 1.5 && r < WALL_D - 2 && ! ( Math.abs( x ) < 4 && z > 0 ) && Math.hypot( Math.abs( x ) - 17.4, z ) > 4.5;

	};

	const outside = ( x, z ) => ! ( Math.abs( x ) < 4.5 && z > 0 );
	for ( let i = 0; i < 40; i ++ ) {

		const a = rand( 0, Math.PI * 2 ), r = rand( 14, 21 );
		const x = Math.sin( a ) * r, z = Math.cos( a ) * r;
		if ( ! inCourtyard( x, z ) ) continue;
		if ( i % 4 === 0 ) {

			const k = kiss();
			k.position.set( x, 0, z );
			k.scale.setScalar( rand( 0.6, 1 ) );
			garden.add( k );
			register( k, { kind: 'kiss', label: 'Meringue kiss' } );

		} else if ( i % 7 === 1 ) {

			const o = iceCream();
			o.position.set( x, 0, z );
			o.scale.setScalar( 0.8 );
			garden.add( o );
			register( o, { kind: 'icecream', label: 'Ice-cream tree' } );

		} else gumdrops.add( x, 0, z, rand( 0.5, 0.9 ) );

	}

	for ( let i = 0; i < 30; i ++ ) {

		const a = ( i / 30 ) * Math.PI * 2 + rand( - 0.06, 0.06 );
		const r = rand( 36, 47 );
		const x = Math.sin( a ) * r, z = Math.cos( a ) * r;
		if ( ! outside( x, z ) ) continue;
		const kind = i % 3;
		let o;
		if ( kind === 0 ) {

			o = lollipop( rand( 1.2, 2.2 ), rand( 3, 5.5 ) );
			o.userData.spinner.rotation.y = a + rand( - 0.6, 0.6 );
			register( o, { kind: 'lollipop', label: 'Lollipop tree' } );

		} else if ( kind === 1 ) {

			o = iceCream( [ pick( FLAVOURS ), pick( FLAVOURS ), pick( FLAVOURS ) ].slice( 0, 2 + ( i % 2 ) ) );
			register( o, { kind: 'icecream', label: 'Ice-cream tree' } );

		} else {

			o = candyCane( rand( 2.8, 4.5 ), Math.random() < 0.5 ? [ 0xff2a4d, 0xffffff ] : [ 0x2bbf6a, 0xffffff ] );
			o.rotation.y = rand( 0, 6.28 );
			register( o, { kind: 'cane', label: 'Candy cane' } );

		}

		o.position.set( x, 0, z );
		garden.add( o );

	}

	for ( let i = 0; i < 190; i ++ ) {

		const a = rand( 0, Math.PI * 2 );
		const r = i < 60 ? rand( WALL_D + 2.2, MOAT_IN - 0.8 ) : rand( MOAT_OUT + 1, CAKE_R - 1.5 );
		const x = Math.sin( a ) * r, z = Math.cos( a ) * r;
		if ( outside( x, z ) ) gumdrops.add( x, 0, z, rand( 0.5, 1.0 ) );

	}

	for ( let i = 0; i < 45; i ++ ) {

		const a = rand( 0, Math.PI * 2 ), r = rand( MOAT_OUT + 1, CAKE_R - 1.5 );
		const x = Math.sin( a ) * r, z = Math.cos( a ) * r;
		if ( ! outside( x, z ) ) continue;
		const k = kiss();
		k.position.set( x, 0, z );
		k.scale.setScalar( rand( 0.6, 1.1 ) );
		garden.add( k );
		register( k, { kind: 'kiss', label: 'Meringue kiss' } );

	}

	build.push( [ gumdrops.mesh, 2.6 ] );

	// ----- gumball lamps along the path -----
	const lamps = [];
	for ( const [ x, z ] of [ [ - 3.6, 24.4 ], [ 3.6, 24.4 ], [ - 3.8, 35.6 ], [ 3.8, 35.6 ] ] ) {

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

	// ----- gummy bear guards -----
	const addBear = ( scale, pos, walk ) => {

		const b = gummyBear( BEAR_COLS[ bears.length % BEAR_COLS.length ] );
		b.scale.setScalar( scale );
		b.position.copy( pos );
		scene.add( b );
		register( b, { kind: 'bear', label: 'Gummy bear guard' } );
		build.push( [ b, 3.8 + bears.length * 0.05 ] );
		bears.push( { obj: b, walk, phase: rand( 0, 6 ) } );
		return b;

	};

	for ( let k = 1; k < 8; k ++ ) {

		const phi = k * Math.PI / 4;
		const base = radial( phi ).multiplyScalar( WALL_D - 0.35 ).setY( WH + 0.4 );
		const a = base.clone().addScaledVector( tangent( phi ), - half + 3.4 );
		const b = base.clone().addScaledVector( tangent( phi ), half - 3.4 );
		addBear( 0.6, a, { a, b, t: Math.random(), dir: Math.random() < 0.5 ? 1 : - 1, speed: rand( 1.2, 2 ), len: a.distanceTo( b ) } );

	}

	for ( const x of [ - 5.4, 5.4 ] ) addBear( 0.9, new THREE.Vector3( x, 0, 26.2 ), null ).rotation.y = 0;
	for ( const x of [ - 2.2, 2.2 ] ) addBear( 0.75, new THREE.Vector3( x, TERRACE_TOP, 8.8 ), null ).userData.dancer = true;

	updaters.push( ( dt ) => {

		for ( const b of bears ) {

			const inner = b.obj.userData.inner;
			const hopping = b.obj.userData.anim?.hop >= 0;
			if ( b.walk ) {

				const w = b.walk;
				w.t += w.dir * w.speed * dt / w.len;
				if ( w.t > 1 || w.t < 0 ) {

					w.t = THREE.MathUtils.clamp( w.t, 0, 1 );
					w.dir *= - 1;

				}

				b.obj.position.x = THREE.MathUtils.lerp( w.a.x, w.b.x, w.t );
				b.obj.position.z = THREE.MathUtils.lerp( w.a.z, w.b.z, w.t );
				if ( ! hopping ) {

					const yaw = Math.atan2( ( w.b.x - w.a.x ) * w.dir, ( w.b.z - w.a.z ) * w.dir );
					let d = yaw - b.obj.rotation.y;
					d = Math.atan2( Math.sin( d ), Math.cos( d ) );
					b.obj.rotation.y += d * Math.min( 1, dt * 6 );

				}

				b.phase += dt * 9;
				inner.rotation.z = Math.sin( b.phase ) * 0.12;
				inner.position.y = Math.abs( Math.sin( b.phase ) ) * 0.12;

			} else if ( b.obj.userData.dancer ) {

				b.phase += dt * 5;
				inner.rotation.z = Math.sin( b.phase ) * 0.25;
				inner.position.y = Math.abs( Math.sin( b.phase ) ) * 0.35;

			} else {

				b.phase += dt * 1.5;
				inner.rotation.z = Math.sin( b.phase ) * 0.05;

			}

		}

	} );

	// ----- orbiting donuts -----
	const donuts = [];
	const donutGeo = new THREE.TorusGeometry( 2.2, 1.05, 32, 64 );
	[ 0xff8fc2, 0x6b3a2a, 0x8fe3ff, 0xfff06a, 0xc6a8ff, 0xffffff, 0x7dff9b, 0xff9a5a ].forEach( ( icing, i ) => {

		const d = new THREE.Mesh( donutGeo, M.donut( icing ) );
		d.castShadow = true;
		const holder = new THREE.Group();
		holder.add( d );
		holder.scale.setScalar( 1.4 );
		scene.add( holder );
		register( holder, { kind: 'donut', label: 'Flying donut' } );
		donuts.push( { holder, mesh: d, a: ( i / 8 ) * Math.PI * 2, r: rand( 62, 74 ), y: rand( 14, 36 ), s: rand( 0.06, 0.1 ), tilt: rand( - 0.6, 0.6 ) } );

	} );
	updaters.push( ( dt, t ) => {

		for ( const d of donuts ) {

			d.a += d.s * dt;
			d.holder.position.set( Math.sin( d.a ) * d.r, d.y + Math.sin( t * 0.8 + d.a * 3 ) * 1.5, Math.cos( d.a ) * d.r );
			d.mesh.rotation.set( 1.1 + d.tilt, t * 0.3 + d.a, 0 );

		}

	} );

	// ----- cotton-candy clouds -----
	const clouds = [];
	const cloudCols = [ 0xffc2e2, 0xc9e6ff, 0xffe0f0, 0xe3d4ff, 0xfff0f7 ];
	for ( let i = 0; i < 22; i ++ ) {

		const c = new THREE.Mesh( cloudGeo(), M.cloud( pick( cloudCols ) ) );
		// Low clouds drift under the island; high ones stay well clear of the camera.
		const low = i < 9;
		const a = rand( 0, Math.PI * 2 ), r = low ? rand( 60, 170 ) : rand( 170, 260 );
		const y = low ? rand( - 60, - 25 ) : rand( 0, 70 );
		c.position.set( Math.sin( a ) * r, y, Math.cos( a ) * r );
		c.scale.setScalar( rand( 1.5, 3.2 ) );
		c.rotation.y = rand( 0, 6 );
		scene.add( c );
		register( c, { kind: 'cloud', label: 'Cotton-candy cloud' } );
		clouds.push( { mesh: c, a, r, y, s: rand( 0.004, 0.01 ) } );

	}

	updaters.push( ( dt, t ) => {

		for ( const c of clouds ) {

			c.a += c.s * dt;
			c.mesh.position.x = Math.sin( c.a ) * c.r;
			c.mesh.position.z = Math.cos( c.a ) * c.r;
			c.mesh.position.y = c.y + Math.sin( t * 0.3 + c.r ) * 1.2;

		}

	} );

	return { updaters, build, towers, rocketBases, keep, heart, heartLight, lamps, gumdrops, gate, bears };

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
