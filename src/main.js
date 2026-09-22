import * as THREE from 'three/webgpu';
import { pass, uniform, hue, saturation, vec4, smoothstep, length, screenUV, mix } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { night } from './materials.js';
import { buildWorld, lollipop, iceCream, candyCane, kiss, CAKE_R, SUN_DIR } from './world.js';
import { SprinkleRain, Effects } from './effects.js';
import { CandyAudio } from './audio.js';
import { squash, spin, grow, updateAnims } from './anim.js';

const $ = ( id ) => document.getElementById( id );

// ---------- renderer ----------

const renderer = new THREE.WebGPURenderer( { antialias: true } );
renderer.setPixelRatio( Math.min( devicePixelRatio, 2 ) );
renderer.setSize( innerWidth, innerHeight );
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$( 'app' ).appendChild( renderer.domElement );

try {

	await renderer.init();

} catch ( e ) {

	$( 'loading' ).innerHTML = '<p>Your browser cannot run WebGPU or WebGL 2 🍬<br>Try a recent Chrome, Edge or Safari.</p>';
	throw e;

}

const isWebGPU = renderer.backend.isWebGPUBackend === true;
$( 'backend' ).textContent = isWebGPU ? 'WebGPU' : 'WebGL 2 fallback';
$( 'backend' ).classList.toggle( 'fallback', ! isWebGPU );

// ---------- scene & camera ----------

const scene = new THREE.Scene();
const DAY_FOG = new THREE.Color( 0xffd9ec ), NIGHT_FOG = new THREE.Color( 0x1b1440 );
scene.fog = new THREE.Fog( DAY_FOG.clone(), 140, 520 );

const pmrem = new THREE.PMREMGenerator( renderer );
scene.environment = pmrem.fromScene( new RoomEnvironment(), 0.04 ).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera( 42, innerWidth / innerHeight, 0.5, 2500 );
const HOME = new THREE.Vector3( 46, 30, 64 );
const START = new THREE.Vector3( - 60, 150, 300 );
camera.position.copy( START );

const controls = new OrbitControls( camera, renderer.domElement );
controls.target.set( 0, 10, 0 );
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 14;
controls.maxDistance = 200;
controls.maxPolarAngle = Math.PI * 0.62;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.enabled = false;

// ---------- lights ----------

const hemi = new THREE.HemisphereLight( 0xfff0f8, 0xffb3d9, 1.3 );
scene.add( hemi );

const sun = new THREE.DirectionalLight( 0xfff1e0, 2.6 );
sun.position.copy( SUN_DIR ).multiplyScalar( 90 );
sun.castShadow = true;
sun.shadow.mapSize.set( 2048, 2048 );
Object.assign( sun.shadow.camera, { left: - 48, right: 48, top: 48, bottom: - 48, near: 10, far: 220 } );
sun.shadow.bias = - 0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 4;
scene.add( sun );

// ---------- world ----------

const audio = new CandyAudio();
const interactive = [];
const register = ( obj, info ) => {

	obj.userData.info = info;
	interactive.push( obj );

};

const world = buildWorld( scene, register );
const rain = new SprinkleRain( isWebGPU ? 6000 : 3500 );
scene.add( rain.mesh );
const fx = new Effects( scene, camera, audio );

const towerTops = world.towers.map( ( t ) => t.position.clone().add( new THREE.Vector3( 0, 20, 0 ) ) );
const rocketBases = [ ...towerTops, new THREE.Vector3( 0, 34, 0 ) ];

// ---------- post-processing: bloom, sugar-rush hue spin, vignette ----------

const pipeline = new THREE.RenderPipeline( renderer );
const scenePass = pass( scene, camera );
const sceneColor = scenePass.getTextureNode( 'output' );
const glow = bloom( sceneColor, 0.55, 0.35, 1.1 );
const hueU = uniform( 0 ), satU = uniform( 1 );
const graded = saturation( hue( sceneColor.rgb.add( glow.rgb ), hueU ), satU );
const vignette = mix( 1, smoothstep( 1.05, 0.3, length( screenUV.sub( 0.5 ) ) ), 0.28 );
pipeline.outputNode = vec4( graded.mul( vignette ), 1 );

// ---------- interaction ----------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tip = $( 'tip' );
const planted = [];
const stats = { clicks: 0, planted: 0 };

function pick( clientX, clientY ) {

	pointer.set( ( clientX / innerWidth ) * 2 - 1, - ( clientY / innerHeight ) * 2 + 1 );
	raycaster.setFromCamera( pointer, camera );
	const hits = raycaster.intersectObjects( interactive, true );
	for ( const h of hits ) {

		let o = h.object;
		while ( o && ! o.userData.info ) o = o.parent;
		if ( o ) return { target: o, info: o.userData.info, point: h.point, instanceId: h.instanceId };

	}

	return null;

}

const PLANTERS = [
	() => lollipop( 0.9 + Math.random() * 0.9, 2 + Math.random() * 2.5 ),
	() => iceCream(),
	() => candyCane( 2 + Math.random() * 2, Math.random() < 0.5 ? [ 0xff2a4d, 0xffffff ] : [ 0x8f6bff, 0xffffff ] ),
	() => kiss(),
	'gumdrops'
];
const PLANT_LABELS = [ 'Lollipop tree', 'Ice-cream tree', 'Candy cane', 'Meringue kiss' ];
const PLANT_KINDS = [ 'lollipop', 'icecream', 'cane', 'kiss' ];

function plant( p ) {

	const r = Math.hypot( p.x, p.z );
	const inCastle = Math.abs( p.x ) < 14 && Math.abs( p.z ) < 14;
	if ( r > CAKE_R - 0.8 || inCastle || ( r > 20 && r < 24.6 ) ) {

		audio.pop();
		fx.burst( p.clone().setY( 0.3 ), 25, 0.6 );
		return;

	}

	const k = Math.floor( Math.random() * PLANTERS.length );
	if ( PLANTERS[ k ] === 'gumdrops' ) {

		for ( let i = 0; i < 3; i ++ ) {

			const id = world.gumdrops.add( p.x + ( Math.random() - 0.5 ) * 2, 0, p.z + ( Math.random() - 0.5 ) * 2, 0.5 + Math.random() * 0.5 );
			world.gumdrops.hop( id );

		}

	} else {

		const o = PLANTERS[ k ]();
		o.position.set( p.x, 0, p.z );
		o.rotation.y = Math.random() * Math.PI * 2;
		scene.add( o );
		register( o, { kind: PLANT_KINDS[ k ], label: PLANT_LABELS[ k ] } );
		grow( o );
		planted.push( o );
		if ( planted.length > 60 ) {

			const old = planted.shift();
			scene.remove( old );
			interactive.splice( interactive.indexOf( old ), 1 );

		}

	}

	stats.planted ++;
	$( 'planted' ).textContent = stats.planted;
	audio.plant();
	fx.burst( p.clone().setY( 0.3 ), 30, 0.7 );

}

function topOf( obj ) {

	const t = obj.userData.top ?? new THREE.Vector3( 0, 3, 0 );
	return obj.localToWorld( t.clone() );

}

function activate( hit ) {

	const { target, info, point } = hit;
	stats.clicks ++;

	switch ( info.kind ) {

		case 'ground':
			plant( point );
			break;

		case 'tower':
			squash( target, 1 );
			audio.boing();
			fx.burst( topOf( target ), 90, 1.2 );
			fx.launch( topOf( target ) );
			break;

		case 'keep':
			squash( target, 0.6 );
			audio.boing();
			fx.show( rocketBases, 8 );
			break;

		case 'lollipop':
			spin( target.userData.spinner ?? target, 25 );
			squash( target, 0.5 );
			audio.chime();
			fx.burst( topOf( target ), 40, 0.8 );
			break;

		case 'gumdrop':
			world.gumdrops.hop( hit.instanceId );
			audio.pop();
			fx.burst( world.gumdrops.position( hit.instanceId ).add( new THREE.Vector3( 0, 1, 0 ) ), 18, 0.6 );
			break;

		case 'cane':
		case 'kiss':
		case 'icecream':
		case 'lamp':
			squash( target, 1 );
			audio.boing();
			fx.burst( topOf( target ), 35, 0.8 );
			break;

		case 'donut':
			spin( target, 30 );
			audio.chime();
			fx.burst( target.position.clone(), 50, 0.9 );
			break;

		case 'cloud':
			squash( target, 0.8 );
			audio.pop();
			fx.burst( target.position.clone(), 120, 0.8 );
			break;

		case 'gate': {

			const door = target.userData.door;
			const open = ! door.userData.open;
			door.userData.open = open;
			door.userData.targetRot = open ? - 1.9 : 0;
			audio.door();
			fx.burst( target.localToWorld( new THREE.Vector3( 0, 2.5, 1.5 ) ), 80, 1 );
			break;

		}

		case 'river':
			audio.splash();
			fx.burst( point.clone().setY( 0.4 ), 40, 0.7 );
			break;

		case 'wall':
		case 'cake':
		default:
			squash( target, 0.25 );
			audio.pop();
			fx.burst( point.clone(), 30, 0.7 );

	}

}

let down = null;
renderer.domElement.addEventListener( 'pointerdown', ( e ) => {

	down = { x: e.clientX, y: e.clientY, t: performance.now() };
	audio.unlock();
	endIntro();

} );

renderer.domElement.addEventListener( 'pointerup', ( e ) => {

	if ( ! down ) return;
	const moved = Math.hypot( e.clientX - down.x, e.clientY - down.y );
	if ( moved < 6 && performance.now() - down.t < 500 ) {

		const hit = pick( e.clientX, e.clientY );
		if ( hit ) activate( hit );

	}

	down = null;
	idle = 0;

} );

let lastMove = null;
renderer.domElement.addEventListener( 'pointermove', ( e ) => {

	lastMove = e;

} );
renderer.domElement.addEventListener( 'pointerleave', () => {

	lastMove = null;
	tip.classList.remove( 'show' );

} );

function updateHover() {

	if ( ! lastMove || lastMove.pointerType === 'touch' ) return;
	const e = lastMove;
	lastMove = null;
	const hit = down ? null : pick( e.clientX, e.clientY );
	renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
	if ( hit ) {

		tip.textContent = hit.info.label;
		tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`;
		tip.classList.add( 'show' );

	} else tip.classList.remove( 'show' );

}

// ---------- modes ----------

const modes = { night: false, rush: false, storm: false };
let hueTarget = 0, rushBeat = 0;

function setMode( name, on = ! modes[ name ] ) {

	modes[ name ] = on;
	$( `btn-${name}` ).classList.toggle( 'on', on );
	audio.unlock();
	if ( name === 'night' ) {

		audio.chime();
		$( 'btn-night' ).querySelector( '.i' ).textContent = on ? '☀️' : '🌙';
		$( 'btn-night' ).querySelector( '.l' ).textContent = on ? 'Day' : 'Night';

	}

	if ( name === 'rush' ) {

		audio.tempo = on ? 2.2 : 1;
		if ( on && ! audio.musicOn ) setMusic( true );
		if ( ! on ) hueTarget = Math.ceil( hueU.value / ( Math.PI * 2 ) ) * Math.PI * 2;

	}

	if ( name === 'storm' ) {

		audio.whoosh();

	}

}

function setMusic( on ) {

	audio.unlock();
	audio.musicOn = on;
	$( 'btn-music' ).classList.toggle( 'on', on );

}

function fireworks() {

	audio.unlock();
	fx.show( rocketBases, 12 );

}

$( 'btn-fireworks' ).onclick = fireworks;
$( 'btn-night' ).onclick = () => setMode( 'night' );
$( 'btn-rush' ).onclick = () => setMode( 'rush' );
$( 'btn-storm' ).onclick = () => setMode( 'storm' );
$( 'btn-music' ).onclick = () => setMusic( ! audio.musicOn );
$( 'btn-mute' ).onclick = () => {

	audio.unlock();
	audio.setMuted( ! audio.muted );
	$( 'btn-mute' ).textContent = audio.muted ? '🔇' : '🔊';

};

addEventListener( 'keydown', ( e ) => {

	if ( e.repeat || e.metaKey || e.ctrlKey ) return;
	const k = e.key.toLowerCase();
	if ( k === 'f' ) fireworks();
	else if ( k === 'n' ) setMode( 'night' );
	else if ( k === 'r' ) setMode( 'rush' );
	else if ( k === 's' ) setMode( 'storm' );
	else if ( k === 'm' ) setMusic( ! audio.musicOn );
	else if ( k === 'h' ) document.body.classList.toggle( 'hide-ui' );

} );

// ---------- intro fly-in ----------

let intro = 0;
let introDone = false;
function endIntro() {

	if ( introDone ) return;
	introDone = true;
	controls.enabled = true;
	$( 'hint' ).classList.add( 'show' );
	setTimeout( () => $( 'hint' ).classList.remove( 'show' ), 7000 );

}

const easeInOut = ( t ) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow( - 2 * t + 2, 3 ) / 2;

// ---------- main loop ----------

const timer = new THREE.Timer();
timer.connect( document );
let idle = 0;
const dayHemi = new THREE.Color( 0xfff0f8 ), nightHemi = new THREE.Color( 0x6d5acf );
const daySun = new THREE.Color( 0xfff1e0 ), nightSun = new THREE.Color( 0x9fb4ff );

controls.addEventListener( 'start', () => {

	idle = 0;
	controls.autoRotate = false;

} );

async function start() {

	await renderer.compute( rain.init );
	await renderer.compileAsync( scene, camera );
	$( 'loading' ).classList.add( 'done' );
	document.body.classList.add( 'ready' );
	renderer.setAnimationLoop( frame );

}

function frame( ts ) {

	timer.update( ts );
	const dt = Math.max( 0, Math.min( timer.getDelta(), 1 / 20 ) );
	const t = timer.getElapsed();

	// Intro camera swoop
	if ( ! introDone ) {

		intro += dt / 5.5;
		const k = easeInOut( Math.min( intro, 1 ) );
		camera.position.lerpVectors( START, HOME, k );
		camera.position.applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), ( 1 - k ) * 1.2 );
		camera.lookAt( controls.target );
		if ( intro >= 1 ) endIntro();

	} else {

		idle += dt;
		if ( idle > 10 ) controls.autoRotate = true;
		controls.update( dt );

	}

	// Day / night blend
	const n = THREE.MathUtils.damp( night.value, modes.night ? 1 : 0, 2.2, dt );
	night.value = n;
	hemi.color.lerpColors( dayHemi, nightHemi, n );
	hemi.intensity = THREE.MathUtils.lerp( 1.3, 0.35, n );
	sun.color.lerpColors( daySun, nightSun, n );
	sun.intensity = THREE.MathUtils.lerp( 2.6, 0.55, n );
	scene.environmentIntensity = THREE.MathUtils.lerp( 0.55, 0.18, n );
	scene.fog.color.lerpColors( DAY_FOG, NIGHT_FOG, n );
	glow.strength.value = THREE.MathUtils.lerp( 0.18, 0.65, n );
	for ( const l of world.lamps ) l.intensity = n * 60;

	// Sugar rush: spin the hue wheel and make the castle dance
	if ( modes.rush ) {

		hueU.value += dt * 1.6;
		satU.value = THREE.MathUtils.damp( satU.value, 1.35, 3, dt );
		rushBeat -= dt;
		if ( rushBeat <= 0 ) {

			rushBeat = 0.45;
			const tw = world.towers[ Math.floor( Math.random() * world.towers.length ) ];
			squash( tw, 0.55 );
			for ( let i = 0; i < 4; i ++ ) world.gumdrops.hop( Math.floor( Math.random() * world.gumdrops.mesh.count ) );

		}

	} else {

		if ( hueU.value < hueTarget ) hueU.value = Math.min( hueTarget, hueU.value + dt * 1.6 );
		satU.value = THREE.MathUtils.damp( satU.value, 1, 3, dt );

	}

	rain.speed.value = THREE.MathUtils.damp( rain.speed.value, modes.storm ? 7 : 1, 2, dt );

	// Door swing
	const door = world.gate.userData.door;
	door.rotation.y = THREE.MathUtils.damp( door.rotation.y, door.userData.targetRot ?? 0, 5, dt );

	for ( const u of world.updaters ) u( dt, t );
	world.gumdrops.update( dt );
	updateAnims( dt );
	fx.update( dt );
	audio.tick( dt );
	updateHover();

	renderer.compute( rain.update );
	pipeline.render();

}

addEventListener( 'resize', () => {

	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( innerWidth, innerHeight );

} );

start();
