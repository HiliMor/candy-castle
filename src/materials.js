import * as THREE from 'three/webgpu';
import {
	uniform, uv, vec2, vec3, float, color, mix, smoothstep, step, fract, floor,
	sin, cos, atan, length, abs, min, max, pow, time, hash, positionLocal,
	positionWorld, normalLocal, TWO_PI, mx_noise_float
} from 'three/tsl';

// Global scene uniforms shared by every shader.
export const night = uniform( 0 ); // 0 = day, 1 = night

// IQ-style rainbow palette, pushed a little towards pastel.
export const palette = ( h ) => {

	const c = vec3( 0.5 ).add( vec3( 0.5 ).mul( cos( TWO_PI.mul( vec3( h ).add( vec3( 0.0, 0.33, 0.67 ) ) ) ) ) );
	return mix( c, vec3( 1 ), 0.18 );

};

// Tiny rotated capsules scattered on a grid: the classic sprinkles pattern.
export function sprinkles( p, density = 0.55 ) {

	const cell = floor( p );
	const f = fract( p ).sub( 0.5 );
	const h = hash( cell.x.add( 500 ).add( cell.y.add( 500 ).mul( 313 ) ) );
	const a = h.mul( 40 );
	const rx = f.x.mul( cos( a ) ).sub( f.y.mul( sin( a ) ) );
	const ry = f.x.mul( sin( a ) ).add( f.y.mul( cos( a ) ) );
	const d = length( vec2( max( abs( rx ).sub( 0.22 ), 0 ), ry ) );
	const mask = smoothstep( 0.11, 0.07, d ).mul( step( density, h ) );
	return { mask, col: palette( fract( h.mul( 7.31 ) ) ) };

}

// Sugar-crystal glints that twinkle and catch the bloom.
export const glitter = ( scale = 40, amount = 3 ) => {

	const cell = floor( positionLocal.mul( scale ) ).add( 100 );
	const h = hash( cell.x.add( cell.y.mul( 97 ) ).add( cell.z.mul( 9173 ) ) );
	return vec3( step( 0.965, h ).mul( pow( sin( time.mul( 2.5 ).add( h.mul( 60 ) ) ).mul( 0.5 ).add( 0.5 ), 8 ) ).mul( amount ) );

};

const cache = new Map();
const memo = ( key, make ) => {

	if ( ! cache.has( key ) ) cache.set( key, make() );
	return cache.get( key );

};

const glossy = ( opts = {} ) => new THREE.MeshPhysicalNodeMaterial( {
	roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06, ...opts
} );

// Helical candy stripes: fract(u * cu + v * cv).
export function stripes( a, b, { cu = 6, cv = 3, width = 0.5, glow = 0 } = {} ) {

	return memo( `stripes${a}${b}${cu}${cv}${width}${glow}`, () => {

		const m = glossy();
		const s = fract( uv().x.mul( cu ).add( uv().y.mul( cv ) ) );
		const d = abs( s.sub( 0.5 ) );
		const t = smoothstep( width * 0.5 - 0.03, width * 0.5 + 0.03, d );
		m.colorNode = mix( color( b ), color( a ), t );
		if ( glow ) m.emissiveNode = mix( color( b ), color( a ), t ).mul( night.mul( glow ) );
		return m;

	} );

}

// Lollipop swirl, driven by the local position so caps and rims both swirl.
export function swirl( a, b, { arms = 2, spiral = 5, glow = 0 } = {} ) {

	return memo( `swirl${a}${b}${arms}${spiral}${glow}`, () => {

		const m = glossy( { roughness: 0.2 } );
		const p = positionLocal;
		const ang = atan( p.z, p.x ).div( TWO_PI );
		const r = length( p.xz );
		const s = fract( ang.mul( arms ).add( r.mul( spiral ) ) );
		const t = smoothstep( 0.46, 0.54, s ).mul( smoothstep( 1.0, 0.94, s ) );
		const c = mix( color( a ), color( b ), t );
		m.colorNode = c;
		m.emissiveNode = glow ? c.mul( night.mul( glow ).add( 0.05 ) ) : glitter( 30, 1.2 );
		return m;

	} );

}

// Pink wafer walls with pressed grid lines, projected in world space.
export function wafer( a, b ) {

	return memo( `wafer${a}${b}`, () => {

		const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.62 } );
		const pw = positionWorld;
		const fx = fract( pw.x.add( pw.z ).mul( 0.62 ) );
		const fy = fract( pw.y.mul( 0.62 ) );
		const d = min( min( fx, fx.oneMinus() ), min( fy, fy.oneMinus() ) );
		const line = smoothstep( 0.1, 0.03, d );
		const n = mx_noise_float( pw.mul( 3.0 ) ).mul( 0.06 );
		m.colorNode = mix( color( a ), color( b ), line ).add( n );
		return m;

	} );

}

// Soft buttercream frosting with optional sprinkles.
export function frosting( base, { sprinkleScale = 0, density = 0.55 } = {} ) {

	return memo( `frost${base}${sprinkleScale}${density}`, () => {

		const m = new THREE.MeshPhysicalNodeMaterial( {
			roughness: 0.42, sheen: 0.6, sheenRoughness: 0.4, sheenColor: new THREE.Color( 0xffffff ),
			clearcoat: 0.35, clearcoatRoughness: 0.3
		} );
		const n = mx_noise_float( positionWorld.mul( 0.35 ) ).mul( 0.05 );
		let c = color( base ).add( n );
		if ( sprinkleScale ) {

			const s = sprinkles( uv().mul( sprinkleScale ), density );
			c = mix( c, s.col, s.mask );

		}

		m.colorNode = c;
		return m;

	} );

}

// Ring donut: dough underneath, glossy icing with sprinkles on top.
export function donut( icing ) {

	return memo( `donut${icing}`, () => {

		const m = new THREE.MeshPhysicalNodeMaterial( { clearcoat: 0.8, clearcoatRoughness: 0.15 } );
		const edge = normalLocal.z.add( 0.25 ).add( sin( uv().x.mul( TWO_PI.mul( 14 ) ) ).mul( 0.14 ) );
		const icingMask = smoothstep( -0.04, 0.04, edge );
		const s = sprinkles( uv().mul( vec2( 70, 14 ) ), 0.5 );
		const top = mix( color( icing ), s.col, s.mask );
		const dough = mix( color( 0xd9954a ), color( 0xf2c27b ), mx_noise_float( positionLocal.mul( 4 ) ).mul( 0.5 ).add( 0.5 ) );
		m.colorNode = mix( dough, top, icingMask );
		m.roughnessNode = mix( float( 0.75 ), float( 0.18 ), icingMask );
		m.clearcoatNode = icingMask;
		return m;

	} );

}

// Waffle cone diamond pattern.
export function waffle() {

	return memo( 'waffle', () => {

		const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.75 } );
		const g1 = fract( uv().x.mul( 16 ).add( uv().y.mul( 6 ) ) );
		const g2 = fract( uv().x.mul( 16 ).sub( uv().y.mul( 6 ) ) );
		const d = min( min( g1, g1.oneMinus() ), min( g2, g2.oneMinus() ) );
		m.colorNode = mix( color( 0xe8aa62 ), color( 0xa8652e ), smoothstep( 0.1, 0.03, d ) );
		return m;

	} );

}

// Sugar-coated gumdrops: instance colours plus twinkling crystals.
export function gumdrop() {

	return memo( 'gumdrop', () => {

		const m = new THREE.MeshPhysicalNodeMaterial( {
			roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.35,
			sheen: 1, sheenColor: new THREE.Color( 0xffffff ), sheenRoughness: 0.3
		} );
		m.emissiveNode = glitter( 18, 2.5 );
		return m;

	} );

}

export function candyGloss( c, opts = {} ) {

	return memo( `gloss${c}${JSON.stringify( opts )}`, () => {

		const m = glossy( { color: c, ...opts } );
		return m;

	} );

}

// Spongy cake body with little air pockets.
export function sponge() {

	return memo( 'sponge', () => {

		const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.95 } );
		const n = mx_noise_float( positionWorld.mul( 1.6 ) );
		const pores = smoothstep( 0.35, 0.6, n ).mul( 0.25 );
		m.colorNode = mix( color( 0xf6cf7d ), color( 0xd59a45 ), pores );
		return m;

	} );

}

// Chocolate river, flowing around the moat with gentle waves.
export function chocolate() {

	return memo( 'choc', () => {

		const m = new THREE.MeshPhysicalNodeMaterial( { roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 } );
		const p = positionLocal;
		const a = atan( p.y, p.x );
		const r = length( p.xy );
		const wave = sin( a.mul( 36 ).sub( time.mul( 1.6 ) ).add( r.mul( 3 ) ) ).mul( 0.08 );
		m.positionNode = vec3( p.x, p.y, p.z.add( wave ) );
		const flow = mx_noise_float( vec3( a.mul( 10 ).sub( time.mul( 0.5 ) ), r.mul( 1.2 ), time.mul( 0.15 ) ) );
		m.colorNode = mix( color( 0x3d1a0c ), color( 0x8a4a26 ), flow.mul( 0.5 ).add( 0.5 ) );
		return m;

	} );

}

// Windows: chocolate glass by day, warm candle glow by night.
export function windowGlow() {

	return memo( 'window', () => {

		const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.3 } );
		const flicker = sin( time.mul( 7 ).add( positionWorld.x.mul( 3 ) ) ).mul( 0.12 ).add( 0.88 );
		m.colorNode = mix( color( 0x5b2c1a ), color( 0xffd27a ), night );
		m.emissiveNode = color( 0xffa94d ).mul( night.mul( 4 ).mul( flicker ) );
		return m;

	} );

}

// Gumball lamps: faint glow by day, blazing by night.
export function lamp( c ) {

	return memo( `lamp${c}`, () => {

		const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.2, color: c } );
		m.emissiveNode = color( c ).mul( night.mul( 5 ).add( 0.25 ) );
		return m;

	} );

}

// Cotton-candy clouds that breathe.
export function cloud( c ) {

	return memo( `cloud${c}`, () => {

		const m = new THREE.MeshPhysicalNodeMaterial( {
			roughness: 1, sheen: 1, sheenColor: new THREE.Color( 0xffffff ), sheenRoughness: 0.8
		} );
		const wobble = mx_noise_float( positionLocal.mul( 1.4 ).add( time.mul( 0.25 ) ) ).mul( 0.22 );
		m.positionNode = positionLocal.add( normalLocal.mul( wobble ) );
		m.colorNode = color( c );
		m.emissiveNode = color( c ).mul( mix( float( 0.12 ), float( 0.35 ), night ) );
		return m;

	} );

}
