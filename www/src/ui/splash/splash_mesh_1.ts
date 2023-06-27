import {Mesh, MeshGeometry, MeshMaterial, Program, Renderer, Texture, WRAP_MODES} from "vauxcel";

const vertex = `in vec2 aVertexPosition;
in vec2 aTextureCoord;

uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform mat3 uTextureMatrix;

out vec2 vTextureCoord;

void main(void)
{
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);

    vTextureCoord = (uTextureMatrix * vec3(aTextureCoord, 1.0)).xy;
}
`; // standard pixi vertex

const fragment = `in vec2 vTextureCoord;

uniform sampler2D uSampler;
uniform float u_time;
uniform vec2 u_resolution;

out vec4 outColor;

//Distance function. Just calculates the height (z) from x,y plane with really simple length check. Its not exact as there could be shorter distances.
vec2 dist(vec3 p)
{
    float id = floor(p.x)+floor(p.y);
    id = mod(id, 2.);
    float h = texture(uSampler, vec2(p.x, p.y)*0.04).r*5.1;
    return vec2(h-p.z,id);
}

//Light calculation.
vec3 calclight(vec3 p, vec3 rd)
{
    vec2 eps = vec2( 0., 0.001);
    vec3 n = normalize( vec3(
    dist(p+eps.yxx).x - dist(p-eps.yxx).x,
    dist(p+eps.xyx).x - dist(p-eps.xyx).x,
    dist(p+eps.xxy).x - dist(p-eps.xxy).x
    ));

    vec3 d = vec3( max( 0., dot( -rd ,n)));

    return d;
}

void main()
{
    vec2 uv = vec2(vTextureCoord.x,1.-vTextureCoord.y);
    uv *=2.;
    uv-=1.;
    uv.x *= u_resolution.x / u_resolution.y;

    vec3 cam = vec3(0.,u_time -2., -3.);
    vec3 target = vec3(sin(u_time)*0.1, u_time+cos(u_time)+2., 0. );
    float fov = 2.2;
    vec3 forward = normalize( target - cam);
    vec3 up = normalize(cross( forward, vec3(0., 1.,0.)));
    vec3 right = normalize( cross( up, forward));
    vec3 raydir = normalize(vec3( uv.x *up + uv.y * right + fov*forward));

    //Do the raymarch
    vec3 col = vec3(0.);
    float t = 0.;
    for( int i = 0; i < 100; i++)
    {
    vec3 p = t * raydir + cam;
    vec2 d = dist(p);
    t+=d.x*0.5;//Jump only half of the distance as height function used is not really the best for heightmaps.
    if(d.x < 0.001)
    {
        vec3 bc = d.y < 0.5 ? vec3(1.0, .8, 0.) :
                vec3(0.8,0.0, 1.0);
        col = vec3( 1.) * calclight(p, raydir) * (1. - t/150.) *bc;
        break;
    }
    if(t > 1000.)
    {
        break;
    }
    }
    outColor = vec4(col, 1.);
}
`;

const splashProgram = Program.from(vertex, fragment, 'splash-shader-1');

export class SplashMesh1 extends Mesh {
    declare shader: MeshMaterial;
    constructor() {
        const mat = new MeshMaterial(Texture.from('./media/splash/perlin.jpg', { wrapMode: WRAP_MODES.REPEAT }), {
            program: splashProgram,
            uniforms: { // uniforms are optional here, just u_resolution is an array
                u_resolution: new Float32Array(2),
                u_time: 0,
            }
        });
        const geom = new MeshGeometry(
            new Float32Array([0, 0, 100, 0, 100, 100, 0, 100]), //vert
            new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), //uv
            new Uint16Array([0, 1, 2, 0, 2, 3])); // index
        super(geom, mat);
    }
    _render(renderer: Renderer) {
        this.shader.uniforms.u_time = performance.now() / 1000.0;
        this.shader.uniforms.u_resolution[0] = (this as any).width;
        this.shader.uniforms.u_resolution[1] = (this as any).height;
        super._render(renderer);
    }
}