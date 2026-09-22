import * as THREE from 'three/webgpu';
import {
	uniform, uv, vec2, vec3, float, color, mix, smoothstep, step, fract, floor,
	sin, cos, atan, length, abs, min, max, pow, time, hash, positionLocal,
	positionWorld, normalLocal, normalView, positionViewDirection, dot, TWO_PI, mx_noise_float
} from 'three/tsl';

// Global scene uniforms shared by every shader.
export const night = uniform( 0 ); // 0 = day, 1 = night
export const heartFlash = uniform( 0 ); // spikes when the crystal heart is clicked

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

// Marks a material as safe to bake into merged static geometry: its pattern
// only depends on uv or world position, never on the mesh's local space.
const mergeable = ( m ) => {

	m.userData.merge = true;
	return m;

};

// Colours and pattern sizes are passed as uniforms, not constants, so materials
// that differ only in flavour share one compiled shader. This keeps start-up fast.
const col = ( c ) => uniform( new THREE.Color( c ) );

const glossy = ( opts = {} ) => new THREE.MeshPhysicalNodeMaterial( {
	roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06, ...opts
} );

// Helical candy stripes: fract(u * cu + v * cv).
export function stripes( a, b, { cu = 6, cv = 3, width = 0.5, glow = 0 } = {} ) {

	return memo( `stripes${a}${b}${cu}${cv}${width}${glow}`, () => {

		const m = glossy();
		const s = fract( uv().x.mul( uniform( cu ) ).add( uv().y.mul( uniform( cv ) ) ) );
		const d = abs( s.sub( 0.5 ) );
		const hw = uniform( width * 0.5 );
		const t = smoothstep( hw.sub( 0.03 ), hw.add( 0.03 ), d );
		const c = mix( col( b ), col( a ), t );
		m.colorNode = c;
		if ( glow ) m.emissiveNode = c.mul( night.mul( uniform( glow ) ) );
		return mergeable( m );

	} );

}

// Lollipop swirl, driven by the local position so caps and rims both swirl.
export function swirl( a, b, { arms = 2, spiral = 5, glow = 0 } = {} ) {

	return memo( `swirl${a}${b}${arms}${spiral}${glow}`, () => {

		const m = glossy( { roughness: 0.2 } );
		const p = positionLocal;
		const ang = atan( p.z, p.x ).div( TWO_PI );
		const r = length( p.xz );
		const s = fract( ang.mul( uniform( arms ) ).add( r.mul( uniform( spiral ) ) ) );
		const t = smoothstep( 0.46, 0.54, s ).mul( smoothstep( 1.0, 0.94, s ) );
		const c = mix( col( a ), col( b ), t );
		m.colorNode = c;
		m.emissiveNode = glow ? c.mul( night.mul( uniform( glow ) ).add( 0.05 ) ) : glitter( 30, 1.2 );
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
		m.colorNode = mix( col( a ), col( b ), line ).add( n );
		return mergeable( m );

	} );

}

// Soft buttercream frosting with optional sprinkles.
export function frosting( base, { sprinkleScale = 0, density = 0.55 } = {} ) {

	return memo( `frost${base}${sprinkleScale}${density}`, () => {

		const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.36 } );
		const n = mx_noise_float( positionWorld.mul( 0.35 ) ).mul( 0.05 );
		let c = col( base ).add( n );
		if ( sprinkleScale ) {

			const s = sprinkles( uv().mul( uniform( sprinkleScale ) ), uniform( density ) );
			c = mix( c, s.col, s.mask );

		}

		m.colorNode = c;
		return mergeable( m );

	} );

}

// Ring donut: dough underneath, glossy icing with sprinkles on top.
export function donut( icing ) {

	return memo( `donut${icing}`, () => {

		const m = new THREE.MeshPhysicalNodeMaterial( { clearcoat: 0.8, clearcoatRoughness: 0.15 } );
		const edge = normalLocal.z.add( 0.25 ).add( sin( uv().x.mul( TWO_PI.mul( 14 ) ) ).mul( 0.14 ) );
		const icingMask = smoothstep( -0.04, 0.04, edge );
		const s = sprinkles( uv().mul( vec2( 70, 14 ) ), 0.5 );
		const top = mix( col( icing ), s.col, s.mask );
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
		return mergeable( m );

	} );

}

// Sugar-coated gumdrops: instance colours plus twinkling crystals.
export function gumdrop() {

	return memo( 'gumdrop', () => {

		const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.32 } );
		m.emissiveNode = glitter( 18, 2.5 );
		return m;

	} );

}

export function candyGloss( c, opts = {} ) {

	return memo( `gloss${c}${JSON.stringify( opts )}`, () => {

		return mergeable( glossy( { color: c, ...opts } ) );

	} );

}

// Spongy cake body with little air pockets.
export function sponge() {

	return memo( 'sponge', () => {

		const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.95 } );
		const n = mx_noise_float( positionWorld.mul( 1.6 ) );
		const pores = smoothstep( 0.35, 0.6, n ).mul( 0.25 );
		m.colorNode = mix( color( 0xf6cf7d ), color( 0xd59a45 ), pores );
		return mergeable( m );

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
		return mergeable( m );

	} );

}

// Gumball lamps: faint glow by day, blazing by night.
export function lamp( c ) {

	return memo( `lamp${c}`, () => {

		const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.2, color: c } );
		m.emissiveNode = col( c ).mul( night.mul( 5 ).add( 0.25 ) );
		return mergeable( m );

	} );

}

// Cotton-candy clouds that breathe.
export function cloud( c ) {

	return memo( `cloud${c}`, () => {

		const m = new THREE.MeshStandardNodeMaterial( { roughness: 1 } );
		const wobble = mx_noise_float( positionLocal.mul( 1.4 ).add( time.mul( 0.25 ) ) ).mul( 0.22 );
		m.positionNode = positionLocal.add( normalLocal.mul( wobble ) );
		const cc = col( c );
		m.colorNode = cc;
		m.emissiveNode = cc.mul( mix( float( 0.12 ), float( 0.35 ), night ) );
		return m;

	} );

}

// Pennant flag: the plane is squeezed into a triangle and waves in the wind.
export function flag( a, b ) {

	return memo( `flag${a}${b}`, () => {

		const m = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide, roughness: 0.55 } );
		const p = positionLocal;
		const u = uv().x; // 0 at the pole
		const wave = sin( time.mul( 6 ).sub( p.x.mul( 1.8 ) ) ).mul( u.mul( 0.45 ) )
			.add( sin( time.mul( 3.1 ).sub( p.x ) ).mul( u.mul( 0.15 ) ) );
		m.positionNode = vec3( p.x, p.y.mul( float( 1 ).sub( u.mul( 0.9 ) ) ), p.z.add( wave ) );
		m.colorNode = mix( col( a ), col( b ), step( 0.5, fract( uv().y.mul( 2.5 ).add( 0.25 ) ) ) );
		return m;

	} );

}

// Gummy candy: glossy, with a glowing rim that fakes light scattering inside.
export function gummy( c ) {

	return memo( `gummy${c}`, () => {

		const m = new THREE.MeshPhysicalNodeMaterial( { color: c, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 } );
		const rim = pow( float( 1 ).sub( abs( dot( normalView, positionViewDirection ) ) ), 2.5 );
		m.emissiveNode = col( c ).mul( rim.mul( 1.1 ).add( 0.22 ).add( night.mul( 0.4 ) ) );
		return m;

	} );

}

// Chocolate curtains pouring over the fountain bowls.
export function chocoFlow() {

	return memo( 'chocoFlow', () => {

		const m = new THREE.MeshPhysicalNodeMaterial( { roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide } );
		const n = mx_noise_float( vec3( uv().x.mul( 24 ), uv().y.mul( 3 ).add( time.mul( 2.2 ) ), 0 ) );
		m.colorNode = mix( color( 0x3d1a0c ), color( 0x94522a ), n.mul( 0.5 ).add( 0.5 ) );
		return m;

	} );

}

// The crystal sugar heart floating above the great spire.
export function crystal() {

	return memo( 'crystal', () => {

		const m = new THREE.MeshPhysicalNodeMaterial( {
			color: 0xff5fa8, roughness: 0.06, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.02,
			iridescence: 1, iridescenceIOR: 1.8, sheen: 0.5, sheenColor: new THREE.Color( 0xffc0e0 )
		} );
		const pulse = sin( time.mul( 2.2 ) ).mul( 0.2 ).add( 1 );
		m.emissiveNode = color( 0xff3d8f ).mul( night.mul( 2.2 ).add( 0.25 ).add( heartFlash.mul( 4 ) ).mul( pulse ) ).add( glitter( 1.2, 4 ) );
		return m;

	} );

}

// Light beam shooting up from the heart at night.
export function beam() {

	return memo( 'beam', () => {

		const m = new THREE.MeshBasicNodeMaterial( {
			transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false
		} );
		const flick = sin( time.mul( 3 ).add( uv().x.mul( TWO_PI.mul( 3 ) ) ) ).mul( 0.15 ).add( 0.85 );
		m.colorNode = color( 0xff7ab8 );
		m.opacityNode = pow( uv().y.oneMinus(), 1.6 ).mul( night.mul( 0.35 ).add( heartFlash.mul( 0.6 ) ) ).mul( flick );
		return m;

	} );

}
