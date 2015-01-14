var wmap = {
    nmap_xml: null,

    scan: function() {
        wmap.scan_name = null;
        wmap.current_tabId = null;
        wmap.current_tab_image_data = null;
        wmap.uri_array = [];
        wmap.uri_pointer = 0;
        wmap.results = {};
        wmap.results_array = [];
        wmap.timeout = 1;
        wmap.timeout_ran = false;
        wmap.use_hostname = false;
        wmap.screenshot_delay = 0;
        wmap.report_data = new JSZip();
        wmap.report_template_html = null;

        $.get( "template/report.html", function( data ) {
            wmap.report_template_html = data;
        });

        if( $( "#prefer_hostname_input" ).is( ':checked' ) ) {
            wmap.use_hostname = true;
        }

        if( $( "#fullscreen_input" ).is( ':checked' ) ) {
            // Go fullscreen for better screenshots
            chrome.windows.getCurrent( {}, function( window_obj ) {
                chrome.windows.update( window_obj.id, { "state": "fullscreen" }, function() {

                });  
            });
        }
        // Set list of URIs to scan
        wmap.set_uri_list(); 
        wmap.scan_name = $( "#input_scan_name" ).val();
        wmap.screenshot_delay = parseInt( $( "#screenshot_delay_input" ).val() ) * 1000;
        wmap.timeout = parseInt( $( "#timeout_input" ).val() ) * 1000;

        if( wmap.uri_array.length > 0 ) {
            wmap.open_tab( wmap.uri_array[0] );
        }
    },

    set_uri_list: function() {
        try {
            var xml = wmap.nmap_xml,
            xmlDoc = $.parseXML( xml ),
            $xml = $( xmlDoc ),
            $title = $xml.find( "host" ).each( function() {
                var host_xml_doc = $( this );
                var hostname = host_xml_doc.find( "hostname" ).attr( "name" );
                var ip = host_xml_doc.find( "address" ).attr( "addr" );
                if( hostname == undefined ) {
                    hostname = ip;    
                }
                host_xml_doc.find( "port" ).each( function() {
                    var port_xml_doc = $( this );
                    var port = port_xml_doc.attr( "portid" );
                    var state_xml_doc = port_xml_doc.find( "state" );
                    var state = state_xml_doc.attr( "state" );
                    var domain;
                    if( state == "open" ) {
                        if( wmap.use_hostname ) {
                            domain = hostname; 
                        } else {
                            domain = ip; 
                        }
                        if( port == "443" ) {
                            wmap.uri_array.push( "https://" + domain );
                        } else {
                            wmap.uri_array.push( "http://" + domain + ":" + port );
                        }
                    }
                });
            });
        } catch( e ) {
            console.log( e );
        }

        var uri_text = $( "#input_url_list" ).val();
        var uri_list = uri_text.split( "\n" ); 
        uri_list.forEach(function( uri, index, tmp_array ) {
            if( uri.indexOf( "://" ) > -1 || uri === "" ) {
            } else {
                tmp_array[ index ] = "http://" + uri;
            }
        });
        wmap.uri_array = wmap.uri_array.concat( uri_list.filter(function(n){ return n != "" }) );
    },

    open_tab: function( uri ) {
        chrome.tabs.create({ "url": uri }, function( tab ) {
            wmap.current_tabId = tab.id;
            var p = wmap.uri_pointer;
            setTimeout( function() {
                wmap.screenshot_failed( p );
            }, wmap.timeout );
        });
    },

    screenshot_tab: function( timed_out ) {
        if( wmap.screenshot_delay > 0 && !timed_out ) {
            setTimeout( function() {
                wmap.take_screenshot( timed_out );  
            }, wmap.screenshot_delay );
        } else {
            wmap.take_screenshot( timed_out );
        }
    },

    take_screenshot: function( timed_out ) {
        chrome.tabs.update( wmap.current_tabId, { "active": true }, function() {
            chrome.tabs.captureVisibleTab( null, { "format": "png" }, function( image_uri ) {
                wmap.current_tab_image_data = image_uri;
                wmap.save_result( timed_out );
            });  
        });
    },

    screenshot_failed: function( uri_num ) {
        if( uri_num === wmap.uri_pointer ) {
            wmap.screenshot_tab( true );
        }
    },

    save_result: function( timed_out ) {
        timed_out = typeof timed_out !== 'undefined' ? timed_out : false;

        wmap.results['uri'] = wmap.uri_array[ wmap.uri_pointer ];

        chrome.tabs.get( wmap.current_tabId, function( tab ) {
            // If there's an issue with the page this will hang. bleh.
            if( !timed_out ) {
                chrome.tabs.executeScript( wmap.current_tabId, { file: "js/inject.js" }, function( return_data ) {
                    if( return_data.length === 0 ) {
                        console.log( 'Something went wrong while sending the probe!' );
                        wmap.results['error'] = true;
                    } else {
                        wmap.results = $.extend( wmap.results, return_data[0] );
                        wmap.results['error'] = false;
                    }
                    wmap.results[ 'screenshot' ] = wmap.current_tab_image_data;
                    wmap.results_array.push( wmap.results );
                    wmap.next_shot();                
                });
            } else {
                wmap.results['error'] = true;
                wmap.results_array.push( wmap.results );
                wmap.next_shot();                
            }
        });
    },

    next_shot: function() {
        wmap.results = {};
        chrome.tabs.remove( wmap.current_tabId, function() {
            wmap.uri_pointer++;
            if( wmap.uri_pointer < wmap.uri_array.length ) {
                wmap.open_tab( wmap.uri_array[ wmap.uri_pointer ] ); 
            } else {
                wmap.generate_report();
            }
        });

    },

    generate_report: function() {
        wmap.generate_template_files( 0 );

        // Stamp report name
        var page_html = wmap.report_template_html;
        page_html = page_html.replace( '{{report_name}}', htmlencode( wmap.scan_name ) );

        // Generate rows 
        var row_data = "";
        var i = 1;
        wmap.results_array.forEach( function( result, index, tmp_array ) {
            var image_filename;
            if( result.cookies !== undefined ) {
                result.cookies = result.cookies.replace( ';', ';\n')
            }
            if( result.screenshot !== undefined ) {
                image_filename = 'images/' + filename_encode( result.uri ) + '-' + i + '.png';
                wmap.report_data.file( image_filename, result.screenshot.replace( 'data:image/png;base64,', '' ), { base64: true } );
            }

            if( result.error ) {
                row_data += '<tr class="report_row danger">\n';
                row_data += '<td class="row_number">' + i + '</td>\n';
                if( result.screenshot === undefined ) {
                    row_data += '<td class="row_screenshot">An error occured while taking this screenshot.</td>\n';
                } else {
                    row_data += '<td class="row_screenshot"><a target="_blank" href="' + image_filename + '"><img class="screenshot" src="' + image_filename + '" /></a></td>\n';
                }
                row_data += '<td class="row_uri"><a target="_blank" href="' + htmlencode( result.uri ) + '">' + htmlencode( result.uri ) + '</a></td>\n';
                row_data += '<td class="row_title">N/A</td>\n';
                row_data += '<td class="row_cookies">N/A</td>\n';
                row_data += '<td class="row_html">N/A</td>\n';
                row_data += '<tr>\n';
            } else {
                row_data += '<tr class="report_row">\n';
                row_data += '<td class="row_number">' + i + '</td>\n';
                if( result.screenshot === undefined ) {
                    row_data += '<td class="row_screenshot">An error occured while taking this screenshot.</td>\n';
                } else {
                    row_data += '<td class="row_screenshot"><a target="_blank" href="' + image_filename + '"><img class="screenshot" src="' + image_filename + '" /></a></td>\n';
                }
                row_data += '<td class="row_uri"><a target="_blank" href="' + htmlencode( result.uri ) + '">' + htmlencode( result.uri ) + '</a></td>\n';
                row_data += '<td class="row_title">' + htmlencode( result.title ) + '</td>\n';
                row_data += '<td class="row_cookies"><a href="javascript:" onclick="viewcookies(' + i + ')" class="btn btn-default">Cookies</a><div id="cookie_data_row_' + i + '" class="hidden_cookie_data">' + htmlencode( result.cookies ) + '</div></td>\n';
                row_data += '<td class="row_html"><a href="javascript:" onclick="viewhtml(' + i + ')" class="btn btn-default">HTML</a><div id="html_data_row_' + i + '" class="hidden_html_data">' + htmlencode( result.html ) + '</div></td>\n';
                row_data += '<tr>\n';
            }
            i++;
        });

        page_html = page_html.replace( '{{data_body}}', row_data );

        wmap.report_data.file( 'report.html', page_html );
        wmap.finish();
    },

    generate_template_files: function( offset ) {
        offset = typeof offset !== 'undefined' ? offset : 0;
        var template_list = [
            "template/css/main.css",
            "template/css/bootstrap.min.css",
            "template/css/default.css",
            "template/fonts/glyphicons-halflings-regular.eot",
            "template/fonts/glyphicons-halflings-regular.svg",
            "template/fonts/glyphicons-halflings-regular.ttf",
            "template/fonts/ODelI1aHBYDBqgeIAH2zlNzbP97U9sKh0jjxbPbfOKg.ttf",
            "template/fonts/source_sans_pro.ttf",
            "template/fonts/toadOcfmlt9b38dHJxOBGLsbIrGiHa6JIepkyt5c0A0.ttf",
            "template/fonts/toadOcfmlt9b38dHJxOBGMw1o1eFRj7wYC6JbISqOjY.ttf",
            "template/js/bootstrap.min.js",
            "template/js/jquery.min.js",
            "template/js/main.js",
            "template/js/highlight.pack.js",
            "template/images/error.jpg",
        ];
        $.get( template_list[ offset ], function( data ) {
            if( offset < template_list.length ) {
                wmap.report_data.file( template_list[ offset ].replace( 'template/', '' ), data );
                wmap.generate_template_files( ( offset + 1 ) )
            }
        });
    },

    serve_report: function() {
        saveAs( wmap.report_data.generate( { type: "blob" } ), filename_encode( wmap.scan_name ) + "-report.zip" );
    },

    finish: function() {
        wmap.nmap_xml = null;
        clearFileInput( document.getElementById( "nmap_xml_input" ) );
        chrome.windows.getCurrent( {}, function( window_obj ) {
            $( '#scan_complete_modal' ).modal( 'show' );
        });
    }, 

}

function filename_encode( value ) {
    if( typeof( value ) !== 'undefined' ) {
        return value.replace(/[^a-z0-9\-]/gi, '_').toLowerCase();
    } else {
        return (new Date().getTime() / 1000).toString().replace('.','');
    }
}

function htmlencode( value ){
    return $('<div/>').text( value ).html();
}

window.onload = function() {
    var fileInput = document.getElementById( 'nmap_xml_input' );

    fileInput.addEventListener('change', function(e) {
        var file = fileInput.files[0];
        var textType = /text.*/;
        if (file.type.match(textType)) {
            var reader = new FileReader();

            reader.onload = function(e) {
                wmap.nmap_xml = reader.result;
            }

            reader.readAsText(file);  
        } else {
            alert( 'Error, bad scan data.' );
        }
    });
}

function clearFileInput( ctrl ) {
    try {
        ctrl.value = null;
    } catch(ex) { }
    if (ctrl.value) {
        ctrl.parentNode.replaceChild(ctrl.cloneNode(true), ctrl);
    }
}

// Watch all incoming status for an alert that our tab has finished loading
chrome.tabs.onUpdated.addListener( function( tabId, info, tab ) {
    if ( info.status == "complete" && tab.id == wmap.current_tabId ) {
        if( !wmap.timeout_ran ) {
            wmap.timeout_ran = false;
            wmap.timed_out = false;
            wmap.screenshot_tab();
        }
    }
});

chrome.browserAction.onClicked.addListener(function() {
    chrome.tabs.create( {'url': "src/index.html"} );
});

$( "#input_scan_name" ).focus();

$('#scan_button').bind('click', function() {
    wmap.scan();
});

$('#download_report_button').bind('click', function() {
    wmap.serve_report();
});
